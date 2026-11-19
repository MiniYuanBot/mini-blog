---
title: "COEER"
description: "A community platform for colleges and organizations, with discussions, feedback, events, and space reservations."
published: 2026-11-19 # Date this project page was added, not a release date.
repository: "https://github.com/MiniYuanBot/coeer"
tags: [typescript, web-applications, postgresql]
---

COEER brings community communication and everyday organizational workflows into
one application. It includes group discussions, feedback, announcements, events,
dormitory allocation, and space reservations.

## Community workflows

- Group creation and approval, membership management, posts, and threaded replies.
- Public and private feedback, with status changes and handling records.
- Event registration, cancellation, capacity limits, and attendance tracking.
- Dormitory questionnaires and allocation, alongside space availability and
  reservation management.
- An administrative dashboard for managing community activity and services.

## Implementation

The application uses React 19, TanStack Start and Router, and TypeScript.
PostgreSQL stores the data, with Drizzle ORM for database access. The interface
includes mobile navigation, light and dark themes, and Markdown and formula
previews.

## Documentation

- [Project overview and roadmap](https://github.com/MiniYuanBot/coeer/blob/main/README.md)
- [Architecture conventions](https://github.com/MiniYuanBot/coeer/blob/main/docs/schema.md)
- [Community features](https://github.com/MiniYuanBot/coeer/blob/main/docs/community-updates.md)
- [Space reservations](https://github.com/MiniYuanBot/coeer/blob/main/docs/open-space.md)
