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

## First Plugin (and model for others)

- [ ] Should be able to be read from the `plugins/` directory
- [ ] Each plugin is a directory under that one
- [ ] `plugins/` as a directory is ignored under Git but `plugins/qtap-plugin-template/` is an exception
- [ ] Manifest file
- [ ] Is an NPM package in its own right
- [ ] Must be called `qtap-plugin-` followed by differentiator
- [ ] Can be found in NPM or Github by a search
- [ ] Template should include
  - [ ] front-end components that can be included in pages or other components
  - [ ] front-end theme changes; can override HTML, CSS
  - [ ] Built-in functionality will include Javascript hooks that can be tied into and run
  - [ ] back-end database table additions
  - [ ] file access will be abstracted so that it can be hooked or replaced by plugins
  - [ ] back-end API endpoints can be added or enhanced
  - [ ] external API support can be added
  - [ ] at least one provider of fake LLM responses should be built to show how to make a provider plugin
  - [ ] there must be a component for configuration that is standardized across all plugins, so it can be called
  - [ ] plugins can be enabled or disabled
  - [ ] all plugins should gracefully degrade somehow

## Hooks

- [ ] Everything meant to be enhanced or replaced by plugins should have hooks placed and documented

## First major thing to move completely to plugins: providers

- [ ] At first one, eventually all but one provider should be moved to plugins

## Second major thing to move completely to plugins: themes

- [ ] We should provide one or two alternative themes to the standard one
- [ ] Themes can use Tailwind (and probably should), but we should allow other toolkits like Bootstrap
