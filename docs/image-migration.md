# Manual image migration inventory

No image binary was changed as part of the architecture refactor. Use this checklist to stage the photography manually, then run `npm run images:build`.

## Homepage hero

All five current hero photographs are JPEG data URLs in `assets/css/styles.css`. They remain operational only as the temporary empty-collection fallback.

| Current reference | Page / section | Proposed destination | Preserve | Follow-up |
| --- | --- | --- | --- | --- |
| Legacy `.slide:nth-child(1)` data URL | Home / hero | `assets/images/home/hero/01.webp` | desktop/mobile `center 48%`; first slide | Add config metadata; generated renderer takes over automatically. |
| Legacy `.slide:nth-child(2)` data URL | Home / hero | `assets/images/home/hero/02.webp` | desktop `center 35%` | Add `position` metadata. |
| Legacy `.slide:nth-child(3)` data URL | Home / hero | `assets/images/home/hero/03.webp` | desktop `center 43%`; mobile `center 38%` | Choose the best single focal position or extend metadata later for responsive crops. |
| Legacy `.slide:nth-child(4)` data URL | Home / hero | `assets/images/home/hero/04.webp` | desktop `center 44%`; mobile `center 42%` | Add `position` metadata. |
| Legacy `.slide:nth-child(5)` data URL | Home / hero | `assets/images/home/hero/05.webp` | desktop `center 48%`; mobile `center 47%` | Add `position` metadata. |

After all desired managed hero files are present and visually approved, a follow-up source-only change can delete the five fallback nodes, their fixed selectors/keyframes, and their embedded payloads.

## Homepage gallery and shared feature image

| Current reference | Page / section | Proposed destination | Embedded? | Preserve / follow-up |
| --- | --- | --- | --- | --- |
| `.gallery-item:nth-child(1)` through `(6)` in `assets/css/styles.css` | Home / favourites gallery | `assets/images/home/gallery/01.webp` through `06.webp` | Yes, six JPEG data URLs | Preserve positions `48%`, `40%`, `45%`, `45%`, `48%`, `52%`; update gallery rendering/references after files exist. |
| `.photo-frame` in `assets/css/styles.css` | Shared/unused legacy content frame | Confirm its intended page before choosing a destination | Yes, one JPEG data URL | Position `center 50%`; no current HTML uses this class, so verify whether it can simply be removed later. |

The gallery repeats at least one hero composition. Decide whether to keep an intentional duplicate file for section-local maintainability or introduce an explicitly documented shared collection; do not silently couple the two sections.

## Our Story and Our People

`story.html` and `venue.html` currently duplicate the same story/people presentation, so both references must be updated together unless one page is retired.

| Current reference | Page / section | Proposed destination | Embedded? | Preserve / follow-up |
| --- | --- | --- | --- | --- |
| `.story-photo` in `assets/css/styles.css` | Story and Venue / feature | `assets/images/story/feature/01.webp` | Yes, JPEG data URL | Preserve `center 48%`; update CSS after the file exists. |
| `Eowyn.png` | Story and Venue / Maddy portrait | `assets/images/story/people/maddy.png` | No, root-level PNG | Preserve alt text “Portrait of Maddy”; update both HTML files. |
| `Merry.png` | Story and Venue / Marc portrait | `assets/images/story/people/marc.png` | No, root-level PNG | Preserve alt text “Portrait of Marc”; update both HTML files. |
| `.party-card-photo-dr-goblin` in `assets/css/portraits.css` | Story and Venue / Dr. Goblin | `assets/images/story/people/dr-goblin.webp` | Yes, JPEG data URL | Preserve centered cover crop and existing ARIA label; update both pages/CSS. |
| `.party-card-photo-luke` in `assets/css/portraits.css` | Story and Venue / Luke | `assets/images/story/people/luke.webp` | Yes, JPEG data URL | Preserve centered cover crop and existing ARIA label; update both pages/CSS. |

`Arwen.png` and `Pippin.png` are root-level image files served by the preview allowlist but have no HTML/CSS references. Confirm whether they are intended future portraits; if so, place them under `assets/images/story/people/` with descriptive names. Otherwise remove them in a separate, explicitly reviewed binary migration.

## References intentionally left operational

- All 13 JPEG data URLs in `assets/css/styles.css` remain because extracting or deleting them would change image binaries or break the staged live site.
- Both JPEG data URLs in `assets/css/portraits.css` remain for the same reason.
- Four root-level PNG files remain byte-for-byte unchanged; two are live `<img>` sources and two are currently unreferenced.
- No schedule, travel, FAQ, registry, or RSVP photography is currently referenced, so no empty image folders were created for those pages.
