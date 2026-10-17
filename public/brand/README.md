# Brand artwork

Files in this folder are served as `/brand/<name>`. They are made from the original pictures in `public/brand-assets/`
(JPEG, solid background) by `npx tsx scripts/prepare-brand-assets.ts`, which turns the background transparent.

| File | Used for |
| --- | --- |
| `main-logo.png` | The LifeWork HIDEAWAY wordmark in black, in the till header |
| `main-logo-white.png` | The same wordmark in white, on the black back office sidebar |
| `radog.png` | The French bulldog head, black line art, behind a product with no photo |

If `radog.png` is missing the till draws a built-in silhouette instead.
