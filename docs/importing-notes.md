# Importing course notes

Run from the blog directory. `pnpm notes` and `pnpm import:notes` are aliases:

```sh
pnpm notes --dry-run
pnpm notes
pnpm diagrams --check
pnpm verify
```

On Windows, use `pnpm.cmd` if PowerShell blocks the `.ps1` launcher, or run `node scripts/import-notes.mjs --dry-run` directly. If the diagram check reports new PlantUML diagrams, run `pnpm diagrams` before verification. It uses the existing `PLANTUML_JAR` / `PLANTUML_SERVER` configuration described in [Authoring](authoring.md).

## Configuration

`notes.config.json` contains an `importNotes` array. Each entry imports one course. Relative paths are resolved from the blog directory, including when using `--config path/to/another.json`.

```json
{
  "importNotes": [
    {
      "from": "../../note-buddy/operating-system/output",
      "to": "src/content/studies/2026-autumn/operating-systems",
      "frontmatter": {
        "course": "Operating Systems",
        "published": "2026-10-10",
        "tags": ["2026-autumn", "operating-systems"],
        "lang": "zh-CN"
      },
      "lectures": {
        "L01": { "slug": "what-operating-systems-do", "title": "What Operating Systems Do" }
      },
      "notes": {
        "questions.md": { "title": "Operating Systems: Review Questions" }
      }
    }
  ]
}
```

`frontmatter.course` and `frontmatter.published` are required. The destination must be `src/content/studies/<semester>/<course>` in lowercase kebab-case. `tags`, `lang`, `draft`, `featured`, and `updated` use the current site's fields. `updated` is optional and manual; it does not change publication order. Old presentation fields such as `heroImageLight`, `excerpt`, and `pubDate` are not emitted.

Use `lectures.L01.title` and `slug` to supply English titles and stable filenames for split lectures. Use `notes["filename.md"]` for individual files, including review questions. Per-note `title`, `description`, `updated`, `tags`, `lang`, `draft`, and `featured` override the common defaults. Without a description override, the importer generates `Course Name, Lecture01.`, `Course Name, Review.`, or `Course Name, Questions.`

## Source layouts and rendering

Both layouts are supported, including a mixture in one course:

```text
output/                         output/
  01-introduction.md              index.md
  02-next-topic.md                L01/
  summary.md                       index.md
  assets/                          chapters/01-first-section.md
                                   chapters/02-next-section.md
                                   assets/
                                 L02/...
                                 questions.md
```

Flat Markdown files become individual articles. Numeric filenames are padded (`2-basics.md` becomes `02-basics.md`). A split `L01/chapters` directory becomes one `01-<slug>.md` article. Sections merge in numeric filename order; the lecture introduction and closing summary remain. Configure a slug for filenames that do not already use English kebab-case.

The importer preserves paragraphs, code, math, Obsidian callouts, tables, Mermaid, and PlantUML. As in the old importer, it removes generated navigation, source-audit callouts and citation footnotes, and sections titled `不确定事项`. Explanatory footnotes and literal code examples remain. Headings, footnotes, and reference links are remapped when chapters merge, including duplicate headings and math headings. Relative note links and wikilinks become `/studies/.../` routes.

Images are copied byte for byte to the course's `assets/` directory. References retain widths and credits; plain image descriptions receive explicit numbered captions for the existing figure layout. PDF, media, and standalone HTML attachments go to `public/downloads/notes/<semester>/<course>/`. Imported notes use the same article rendering pipeline and theme as existing notes.

## Dates and order

Every note in one configured course receives exactly `frontmatter.published`, as a `YYYY-MM-DD` value. Source dates, file modification times, and the import time do not change it. Per-note publication dates cannot override this shared date. Different courses may specify different dates; give them the same value if the whole import should share one date.

The site sorts by publication date descending, then by complete content path in natural ascending order. Within a same-date course, the result is `01`, `02`, …, `10`, followed by unnumbered notes such as `questions` and `summary`. Courses with the same date stay grouped by directory. This shared order feeds listings, tags, RSS, and the search index. Search results still prioritize relevance.

## Repeating an import

`--dry-run` resolves every course, image, and note link, then prints the proposed order and write counts without changing files. All configured courses are validated before writing any of them.

Repeating an unchanged import produces zero writes. Before replacing a changed destination file, the importer saves its previous bytes to `.cache/note-import-backups/<run>/`, preserving the project-relative path. Source directories are read-only inputs. Files absent from the new import are retained; after renaming a slug, remove the obsolete article yourself after updating incoming links.

Keep lasting content edits in the source notes and metadata overrides in `notes.config.json`, so subsequent imports preserve them. Backups are local and ignored by Git.
