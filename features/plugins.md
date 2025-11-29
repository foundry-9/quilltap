# Plugins

There should be Node.js-based plugin architecture so that updates and add-ons can be managed outside the core functionality.

## Concept

- All installations go under `plugins/`
- Should be developed using TypeScript to a certain interface
- All plugin activity must be sandboxed as much as possible for security reasons; only what is exposed can be altered
- Should be able to affect all areas of UI with regard to templates, CSS, fonts, images
- Should be able to implement new - not patch existing, I don't think - back-end APIs and database accesses
- Could be a way to ship database replacements (!) or file back-end replacements

## Functionality

- Themes
- Back-end
  - New API endpoints
  - New database "tables"
  - New functionality for backup and CRUD of database and files
- Front-end
  - New pages and routes
  - New components
  - New tabs and interface add-ons and buttons

## Update mechanism

Using GitHub Pages to make pointers available for people, and a front-end for browse and installation
