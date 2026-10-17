# สำรองข้อมูลอัตโนมัติ (Backup) และการกู้คืน (Restore)

Supabase แผน Free ไม่มี backup รายวัน ระบบนี้จึงสำรองฐานข้อมูลเองทุกคืนโดยไม่เสียค่าใช้จ่าย:

```
GitHub Actions (02:00 น. เวลาไทย)
  → pg_dump ฐานข้อมูล (schema public ทุกตารางของ POS)
  → ตรวจว่าไฟล์อ่านได้และมีข้อมูลจริง
  → เข้ารหัส AES-256 ด้วยรหัสผ่านของคุณ (gpg)
  → อัปโหลดไป S3-compatible storage ของคุณ
  → ตรวจว่าขนาดไฟล์ปลายทางตรงกับที่ส่ง
```

ไฟล์ที่อยู่ใน storage เป็นไฟล์เข้ารหัส ต่อให้ bucket รั่ว ก็เปิดอ่านไม่ได้ถ้าไม่มี `BACKUP_PASSPHRASE`

ไฟล์ที่เกี่ยวข้อง: `.github/workflows/db-backup.yml`, `scripts/backup/db-backup.sh`, `scripts/backup/db-restore.sh`

## สิ่งที่สำรอง และสิ่งที่ไม่สำรอง

| สำรอง | ไม่สำรอง |
| --- | --- |
| สินค้า, สต็อก, ออเดอร์, สมาชิก, ผู้ใช้, audit log (schema `public` ทั้งหมด รวมตาราง migration) | **รูปสินค้าใน Supabase Storage** (bucket `product-images`) ไม่อยู่ใน pg_dump |
| | schema ของ Supabase เอง (`auth`, `storage`, ...) ระบบ POS ไม่ได้ใช้ login ของ Supabase Auth |

รูปสินค้าอัปโหลดใหม่ได้เสมอ (ไฟล์ละไม่เกิน 150 KB) แต่ถ้าต้องการสำเนารูปด้วย ให้ถามเพิ่มได้ครับ

## ทำไมไม่ใช้ Vercel Cron

Vercel function ไม่มีโปรแกรม `pg_dump`, มีเวลารันจำกัด และข้อมูลทั้งฐานจะต้องผ่านเว็บแอป GitHub Actions มี `pg_dump` ให้ติดตั้ง รันได้นานพอ และไม่ฟรีเฉพาะในฝั่ง Vercel ของคุณ จึงเหมาะกว่า

## ตั้งค่าครั้งแรก (ทำครั้งเดียว ประมาณ 15 นาที)

### 1. สร้าง bucket เก็บไฟล์สำรอง

ใช้บริการที่เข้ากันกับ S3 อันใดอันหนึ่ง:

- **Cloudflare R2** (แนะนำ): ฟรี 10 GB ถาวร ไม่คิดค่าดาวน์โหลด สร้าง bucket แล้วสร้าง API token แบบ Object Read & Write เฉพาะ bucket นั้น ต้องใช้ endpoint รูปแบบ `https://<account-id>.r2.cloudflarestorage.com` และ region เป็น `auto`
- **AWS S3**: สร้าง bucket (เช่น `ap-southeast-1`) ตรวจเงื่อนไข Free Tier ล่าสุดของ AWS ก่อน เพราะเปลี่ยนบ่อย
- Backblaze B2 ก็ใช้ได้ (ฟรี 10 GB)

Google Drive ไม่รองรับโดยตรง เพราะต้องใช้ OAuth และ token หมดอายุได้ จะทำให้ backup เงียบหายโดยไม่รู้ตัว จึงเลือกใช้ storage แบบ S3

สิทธิ์ของ key ควรให้เท่าที่จำเป็น สำหรับ AWS ใช้ policy นี้ (แก้ชื่อ bucket):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject"],
      "Resource": "arn:aws:s3:::YOUR-BUCKET/lifework-pos/*"
    }
  ]
}
```

(ไม่มีสิทธิ์ลบ ผู้ไม่หวังดีที่ได้ key ไปก็ลบ backup ไม่ได้)

### 2. connection string ของฐานข้อมูล

Supabase → Project → **Connect** → **Session pooler** (พอร์ต **5432**) นี่คือค่าเดียวกับ `DIRECT_URL` ใน `.env`

- อย่าใช้ Transaction pooler (พอร์ต 6543) เพราะ `pg_dump` ใช้ไม่ได้
- อย่าใช้ `db.<ref>.supabase.co` โดยตรง เพราะแผน Free เป็น IPv6 เท่านั้น แต่ GitHub runner ใช้ IPv4
- ถ้าเผลอใส่ `DATABASE_URL` ที่มี `?pgbouncer=true` สคริปต์จะตัดตัวเลือกของ Prisma ออกให้เอง

### 3. รหัสผ่านเข้ารหัส

สร้างรหัสยาว ๆ แบบสุ่ม:

```bash
openssl rand -base64 32
```

**เก็บไว้ใน password manager อย่างน้อยสองที่** ถ้ารหัสหาย ไฟล์สำรองทั้งหมดจะเปิดไม่ได้ตลอดไป และห้ามใส่ในโค้ดหรือแชร์ในแชท

### 4. ใส่ GitHub Secrets

GitHub → repository → Settings → Secrets and variables → Actions → New repository secret:

| Secret | ค่า |
| --- | --- |
| `BACKUP_DATABASE_URL` | Session pooler connection string จากข้อ 2 |
| `BACKUP_PASSPHRASE` | รหัสจากข้อ 3 (อย่างน้อย 16 ตัวอักษร) |
| `BACKUP_S3_BUCKET` | ชื่อ bucket |
| `BACKUP_S3_ENDPOINT` | R2/B2: endpoint ของบริการ, AWS S3: ปล่อยว่าง |
| `BACKUP_AWS_ACCESS_KEY_ID` | Access key ID |
| `BACKUP_AWS_SECRET_ACCESS_KEY` | Secret access key |
| `BACKUP_AWS_REGION` | เช่น `ap-southeast-1` (R2 ใช้ `auto`) |

### 5. ทดสอบรันครั้งแรกด้วยมือ

GitHub → **Actions** → **Nightly database backup** → **Run workflow** รอจนเป็นสีเขียว แล้วเปิด bucket ดูว่ามีไฟล์ `lifework-pos/daily/lifework-pos-<วันที่>.dump.gpg`

ถ้าล้มเหลว เปิด log ของ step "Dump, encrypt and upload" ข้อความจะบอกว่าขาด secret ตัวไหน หรือเชื่อมต่อฐานข้อมูลไม่ได้ (log จะไม่แสดงรหัสผ่านใด ๆ)

### 6. ตั้งอายุไฟล์ (lifecycle)

สคริปต์ไม่ลบอะไรเลย ให้ตั้งกฎใน storage ให้ลบไฟล์ใน `lifework-pos/daily/` ที่เก่ากว่า 30 วัน (S3: Management → Lifecycle rules, R2: Settings → Object lifecycle rules) ฐานข้อมูล 13 MB ผ่านการบีบอัดและเข้ารหัสแล้วเหลือไม่กี่ MB ต่อคืน 30 วันใช้พื้นที่น้อยกว่า 200 MB

## การแจ้งเตือนเมื่อ backup ล้มเหลว

- GitHub ส่งอีเมลหาคนที่แก้ workflow ล่าสุดเมื่อรันตามเวลาแล้วล้มเหลว
- ถ้า repository เป็น public GitHub จะหยุด schedule เองเมื่อไม่มี commit 60 วัน ให้เข้า Actions เดือนละครั้ง ตรวจว่ามีรันสีเขียวล่าสุด
- เวลา 02:00 อาจเลื่อนได้ราวหนึ่งชั่วโมงเมื่อ GitHub คิวแน่น

## กู้คืนข้อมูล (Restore)

กู้คืนลงฐานข้อมูล **ใหม่ที่ว่างเปล่า** เท่านั้น สคริปต์ไม่ล้างหรือลบอะไร ถ้าฐานเป้าหมายมีตารางอยู่แล้วจะหยุดพร้อมแจ้ง error

1. ติดตั้ง PostgreSQL client เวอร์ชัน 17 ขึ้นไป (`pg_restore`) และ gpg ฐานเป้าหมายต้องเป็น PostgreSQL 17 ขึ้นไปด้วย เพราะไฟล์ที่ `pg_dump` 17 สร้างกู้ลงเวอร์ชันเก่ากว่าไม่ได้
2. ดาวน์โหลดไฟล์ `.dump.gpg` ที่ต้องการจาก bucket
3. สร้างฐานข้อมูลเปล่า เช่น Supabase project ใหม่ แล้วเอา Session pooler connection string มาเป็น `<target-url>`
4. รัน:

```bash
BACKUP_PASSPHRASE='รหัสจากข้อ 3' scripts/backup/db-restore.sh lifework-pos-2026-10-18T190000Z.dump.gpg '<target-url>'
```

5. ตรวจจำนวนแถวในตาราง `Product`, `Order` แล้วชี้ `DATABASE_URL` และ `DIRECT_URL` บน Vercel ไปยังฐานใหม่ จากนั้น redeploy
6. รูปสินค้า: bucket `product-images` ต้องสร้างใหม่ด้วย `supabase/storage-product-images.sql` และอัปโหลดรูปใหม่ (ไม่อยู่ใน backup)

## ซ้อมกู้คืนทุกไตรมาส

backup ที่ไม่เคยลองกู้คืนยังไม่ใช่ backup ที่เชื่อถือได้ ทุก 3 เดือนให้ทำขั้นตอนข้างบนลงฐานชั่วคราว (Supabase project ฟรีใหม่) ตรวจว่าจำนวนแถวตรงกับระบบจริง แล้วลบฐานชั่วคราวทิ้ง

## เปลี่ยนรหัสผ่านเข้ารหัส

เปลี่ยนค่า `BACKUP_PASSPHRASE` ได้ทุกเมื่อ แต่ไฟล์เก่าต้องใช้รหัสเดิมในการเปิด จึงเก็บรหัสเก่าไว้จนกว่าไฟล์เหล่านั้นจะหมดอายุตาม lifecycle
