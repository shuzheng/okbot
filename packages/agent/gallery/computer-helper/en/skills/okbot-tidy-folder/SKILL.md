---
name: "okbot-tidy-folder"
description: "Tidies a local folder by type and moves files only after the user agrees. Use when the user wants to tidy Downloads, Desktop or another folder."
---

# Okbot-tidy-folder skill

## When to use this skill
Use when the user wants to tidy Downloads, Desktop, or another local folder.

## How it works
1. Use read-only commands to list the files, their size and their date.
2. Put them in groups by type (images, documents, archives, installers, other).
3. Tell the user the plan: which subfolder each group goes to.
4. Move the files only after the user agrees. Do not delete files.
5. At the end, report how many files you moved.

## Examples
User: "Please tidy my Downloads folder."

## Notes
Do not delete files, format disks, or tidy a remote server.

