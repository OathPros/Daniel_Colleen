# Image management

The site discovers managed images at build time. Folder contents are the source of truth; HTML, CSS, and JavaScript do not contain a second filename list.

## Intended folder map

The homepage hero and Moments We Love collections are ready for images. Create the other folders when their first manually migrated image is ready.

```text
assets/images/
├── home/
│   ├── hero/                 # homepage slideshow
│   └── moments/              # up to 50 homepage Moments We Love photos
└── story/
    ├── feature/              # story feature photograph (planned)
    └── people/               # wedding-party portraits (planned)
```

Future folders such as `venue/gallery` or `travel/gallery` require no scanner changes. A page opts into a collection when it is ready; the generator does not automatically turn folders into slideshows.

## Everyday hero workflow

The homepage supports **1–99 hero images without editing homepage HTML, CSS, or JavaScript**.

### Replace

1. Overwrite `assets/images/home/hero/03.webp`, keeping its filename.
2. Run `npm run images:build`.
3. Commit and push the image and generated manifest.

### Add

1. Add the next numbered file, for example `assets/images/home/hero/07.webp`.
2. Run `npm run images:build`.
3. Commit and push.

### Remove

1. Delete the image file.
2. Run `npm run images:build`.
3. Commit and push.

### Reorder

Rename or renumber the files, then run `npm run images:build`. Natural filename order is slideshow order, so `09.webp` comes before `10.webp`.

### Change cropping

Edit `assets/images/home/hero/hero.config.json`; configuration adds metadata but never adds an image to the collection.

```json
{
  "01.webp": { "position": "center" },
  "02.webp": { "position": "center 30%" },
  "03.webp": { "position": "65% center" }
}
```

The value uses CSS `background-position` syntax. `center` is the default. A smaller vertical percentage such as `center 30%` keeps more of the upper part of a portrait; `65% center` moves the horizontal focal point right. Optional `alt` and `caption` strings are retained in the manifest for future meaningful-image renderers. The decorative hero itself remains hidden from assistive technology at the slide level.

## Build and validation

`npm run images:build` recursively scans `assets/images`, naturally sorts `.webp`, `.jpg`, `.jpeg`, `.png`, and `.avif` files, combines optional `*.config.json` metadata, and writes `assets/data/images.generated.js`. Hidden and non-image files are ignored. Output is deterministic and uses site-relative web paths.

The generated shape is:

```js
window.WEDDING_IMAGE_MANIFEST = {
  schemaVersion: 1,
  collections: {
    "home/hero": [
      { src: "assets/images/home/hero/01.webp", position: "center" }
    ]
  },
  warnings: []
};
```

Do not edit that file manually. `npm run images:check` compares it with a fresh in-memory scan and fails if it is stale; `npm run check` includes that validation. Metadata for a missing file creates a warning and does not create a slide. A configured empty collection is represented by an empty array and warning.

The first managed hero image is requested with high priority. Once it loads, managed slides replace the temporary legacy markup. Only the next slide is progressively decoded in advance. One image has no timer or progress UI; two or more loop every nine seconds. Reduced-motion visitors see only the first image.

## Moments We Love workflow

Place as many as 50 numbered images in `assets/images/home/moments/` and run `npm run images:build`. The gallery uses natural filename order, so `01.webp` through `50.webp` appear in that order. It automatically creates every thumbnail and includes every photo in the lightbox; no HTML edits are needed.

Optional crop positions and accessible descriptions belong in `moments.config.json`:

```json
{
  "01.webp": { "position": "center 35%", "alt": "Daniel and Colleen beside the lake" },
  "02.webp": { "position": "60% center", "caption": "An autumn walk" }
}
```

When the folder is empty, the six temporary gallery images remain visible. As soon as the folder contains a photo and the manifest is rebuilt, the managed collection replaces all of those placeholders.

## Temporary migration state

The homepage deliberately retains the embedded five-image slideshow as a compatibility fallback whenever `home/hero` is empty. With one or more hero files present, rebuilding the manifest makes the managed renderer take over automatically.

## File guidance

- **Hero:** roughly 1920px wide or greater where source quality allows, landscape-friendly, WebP preferred, and generally below 500 KB where visually acceptable.
- **Content:** roughly 1200–1600px wide where appropriate, WebP preferred, and generally below 300 KB where visually acceptable.

These are recommendations, not build failures. Optimize only where visual fidelity remains acceptable.
