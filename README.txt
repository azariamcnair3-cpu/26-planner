Personal Planner: original layout + custom solo planner.

1. Backup current planner first via Settings -> Download backup (.json).
2. Extract ZIP and upload index.html, manifest.webmanifest, sw.js, icons to a test branch or separate repo before changing your existing main GitHub Pages site.
3. Open site in iPad Safari, Share -> Add to Home Screen -> Open as Web App.
4. Your personal calendar/task/photo data remain on your device in localStorage; use regular JSON backups and restore on new devices.
5. This standalone PWA supports ICS import/export; it DOES NOT support automatic two-way Google/iCloud sync. True sync requires private backend, individual OAuth and CalDAV authorization. No buttons falsely claim accounts are connected.
6. Existing storage key famplanner1 is maintained for migration when deployed to the same origin. Seed family sample entries are skipped when sample=1. Backups are always recommended before updating.
