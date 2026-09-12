# Daniel & Colleen Wedding Website

Static multi-page wedding website hosted on GitHub Pages, with a Cloudflare Worker and D1-backed private RSVP API.

See **[RSVP deployment and operations](docs/rsvp-deployment.md)** for architecture, setup, import, deployment, backup, and data-access instructions.

## File structure

```text
.
├── index.html
├── venue.html
├── schedule.html
├── travel.html
├── faq.html
├── story.html
├── registry.html
├── rsvp.html
├── assets/
│   ├── css/
│   │   └── styles.css
│   ├── js/
│   │   └── main.js
│   └── images/
└── README.md
```

## Publish on GitHub Pages

1. Create a new GitHub repository, for example `daniel-colleen-wedding`.
2. Upload or commit these files to the repository root.
3. Go to **Settings > Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Select branch `main` and folder `/root`.
6. Save.

The site should publish at:

```text
https://YOUR-GITHUB-USERNAME.github.io/daniel-colleen-wedding/
```

## Notes

- GitHub Pages remains the site origin. Cloudflare intercepts only `/api/rsvp/*`; every other request continues to Pages.
- Never add the private guest CSV to this repository. Files under `private/` and `*.private.csv` are ignored.
- The large slideshow imagery is currently preserved in `assets/css/styles.css` as embedded data URLs from the original single-file mockup. For a cleaner production repo, replace those with image files in `assets/images/` and update the CSS paths.
