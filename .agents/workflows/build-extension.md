---
description: Build and update the Chrome extension for SIAP
---

To ensure the Chrome extension in the `dist` folder is updated with the latest changes from `src` and `public`:

1. Open a terminal in the project root.
// turbo
2. Run the build command:
```bash
npm run build:dev
```

3. Open Chrome and go to `chrome://extensions`.
4. Locate the **SIAP Frequência** extension and click the **Reload** (circular arrow) icon.
5. Refresh the SIAP page to see the changes.
