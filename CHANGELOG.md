# Changelog

## 1.0.5 - Hover Tooltip Overhaul and Bug Fixes - 27-05-2026
- **Instant Tooltips:** Replaced native browser delays with a custom floating window engine. The match counter badge now displays the list of grabbed plugins instantly on hover with a 0ms delay.
- **Scroll Immunity:** Tooltips automatically dismiss the exact moment you begin scrolling inside the settings menu, preventing awkward visual overlaps.
- **Improved Settings State:** The "Collapse by default" feature now wipes the opened/closed memory the exact moment you close the settings window, rather than forcing you to wait for a background timer.
- **Bug fixes**: Fully migrated to ID matching instead of name matching, solving name-change duplication and multilanguage issues.

**Full Changelog**: https://github.com/CyrylSz/obsidian-settings-sidebar-organizer/compare/1.0.4...1.0.5

## 1.0.4 - Multi-folder support, Sorting, and Quality of Life fixes - 26-05-2026
- **Multi-folder support**: Plugins can now live in multiple groups at the same time. If they do not match any, they safely fall into the "Ungrouped" folder.
- **Collapse by default**: Added a new setting toggle. If enabled, your folders will always start neatly closed when you open the settings menu.
- **Live match counter**: There is now a subtle badge next to your keyword boxes. Hover over it to instantly see exactly which plugins are being pulled into that group (including info about duplications if a plugin matches multiple keywords).
- **Sorting dropdown**: Added a new dropdown in the group management menu to sort your plugins alphabetically by alias.
- **Bug fixes**: Fixed an issue where certain plugins (like Enhancing Export) were missed by the scanner, and made the "Save changes" button smarter so it only lights up when actual changes are made.

**Full Changelog**: https://github.com/CyrylSz/obsidian-settings-sidebar-organizer/compare/1.0.3...1.0.4

## 1.0.3 - Security Patch and Guidelines Compliance - 22-03-2026
- **Security Patch:** Replaced inline HyperText Markup Language injections with native Document Object Model creation methods to eliminate Cross-Site Scripting vulnerabilities.
- **Styling Refactor:** Moved all remaining hardcoded element styles to the dedicated Cascading Style Sheets file to ensure full compatibility with community themes.
- **User Interface Polish:** Updated settings text to use proper sentence case and removed redundant headings to seamlessly blend with the native Obsidian User Interface.

**Full Changelog**: https://github.com/CyrylSz/obsidian-settings-sidebar-organizer/compare/1.0.2...1.0.3

## 1.0.2 - Code Cleanup and Rendering Fixes - 18-03-2026
- **Styling Refactor:** Extracted all Cascading Style Sheets into a dedicated `styles.css` file.
- **Rendering Reliability:** Fixed a race condition where the sidebar would sometimes fail to organize on slower computers.

**Full Changelog**: https://github.com/CyrylSz/obsidian-settings-sidebar-organizer/compare/1.0.1...1.0.2

## 1.0.1 - Refresh Fix - 9-03-2026
fix: refresh proxy buttons on plugin status changes

## 1.0.0 - Initial Release - 15-02-2026
Initial release! 🎉
