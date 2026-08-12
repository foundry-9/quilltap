---
url: /settings?tab=system
---

# Data Directory

> **[Open this page in Quilltap](/profile)**

The Data Directory section on your profile page shows you where Quilltap stores all your data, including your database, files, and logs.

## Understanding Your Data Directory

Quilltap stores all your data in a single directory on your system. This includes:

- **data/** - Your SQLite database containing all characters, chats, memories, and settings
  - **data/quilltap.dbkey** - The database encryption key file (encrypted at rest using SQLCipher); one per instance, opening all three databases. Keep this file safe and back it up alongside your database — without it, your database cannot be opened
- **files/** - Uploaded files, images, and attachments
- **logs/** - Application logs for troubleshooting
- **plugins/npm/** - Any npm-installed plugins

## Where Is My Data?

The data directory location depends on your operating system:

| Platform | Default Location |
|----------|------------------|
| macOS | `~/Library/Application Support/Quilltap` |
| Windows | `%APPDATA%\Quilltap` |
| Linux | `~/.quilltap` |
| Docker | `/app/quilltap` (mounted from host) |

### Custom Location

You can override the default location by setting the `QUILLTAP_DATA_DIR` environment variable before starting Quilltap. This is useful if you want to:

- Store data on a different drive
- Use a shared network location
- Keep data in a specific backup location

**Note:** In Docker environments, `QUILLTAP_DATA_DIR` is ignored because the container must use the path that matches the volume mount.

## Opening Your Data Directory

### On Desktop (macOS, Windows, Linux)

Click the **Open in File Browser** button to open the data directory directly in your system's file browser:

- **macOS** - Opens in Finder
- **Windows** - Opens in File Explorer
- **Linux** - Opens in your default file manager (Nautilus, Dolphin, Thunar, or via xdg-open)

This makes it easy to:

- Browse your uploaded files
- Back up your data manually
- Access logs for troubleshooting
- Manage plugins

### In Docker

When running Quilltap in Docker, the "Open in File Browser" button is not available because the file browser would need to run inside the container.

Instead, access your data through your **host system**:

1. Find the volume mount path you used with `docker run -v /path/to/data:/app/quilltap`
2. Open that directory on your host system

For example, if you're using the default configuration:
- **macOS/Linux**: Open `~/.quilltap` in Finder or your file manager
- **Windows**: Open `%USERPROFILE%\.quilltap` in File Explorer

## Copying the Path

Click the copy button next to the path to copy it to your clipboard. This is useful for:

- Pasting into a terminal
- Adding to backup scripts
- Sharing in support requests

## Backing Up Your Data

Your data directory contains everything Quilltap needs. To create a backup:

1. Stop Quilltap (optional, but recommended for consistency)
2. Copy the entire data directory to your backup location
3. Restart Quilltap

For more comprehensive backup strategies, see the Backup and Restore documentation.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=system")`

## Related Topics

- [Your Profile](profile.md) - Overview of the profile page
- [Settings](settings.md) - Overview of all configuration options
