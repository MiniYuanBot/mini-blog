---
title: "Course Fetch"
description: "Organize and batch-download lecture recordings from Peking University's course portal."
published: 2026-11-19 # Date this project page was added, not a release date.
repository: "https://github.com/MiniYuanBot/course-fetch"
tags: [javascript, browser-tools]
---

Course Fetch is a Tampermonkey userscript for collecting and downloading lecture
recordings from Peking University's course portal. It brings recordings from
multiple pages into one list, ordered by class time and named consistently.

## Recording workflow

- Collect recordings across pages and merge duplicate entries.
- Exclude dates with empty recordings and renumber the remaining lectures.
- Download selected recordings in batches, with progress, cancellation, and
  individual results for each recording.
- Remux supported streams into MP4 without re-encoding; retain the original TS
  format when remuxing is unavailable.

## Browser integration

Chrome and Edge can write recordings directly to a selected directory. Safari
and Firefox use browser-save fallbacks, including temporary filesystem storage
where available. Downloads use the recordings accessible to the signed-in
course account.

The implementation uses JavaScript and Tampermonkey. The repository documents
the download pipeline, file-writing strategies, and MP4 remuxing separately.

## Documentation

- [Installation and usage](https://github.com/MiniYuanBot/course-fetch/blob/main/README.md)
- [Architecture](https://github.com/MiniYuanBot/course-fetch/blob/main/docs/ARCHITECTURE.md)
- [MP4 remuxing](https://github.com/MiniYuanBot/course-fetch/blob/main/docs/MP4.md)
- [Releases](https://github.com/MiniYuanBot/course-fetch/releases)
