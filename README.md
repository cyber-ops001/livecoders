# Live Coders V7

V7 focuses on a fast, database-backed community workspace.

## Supabase setup

### Existing V6 database
Run **database/V7_workspace_fix.sql** once in Supabase SQL Editor.

### New database
Run **database/schema.sql** from top to bottom.

## Community logo upload
Community logos are uploaded to:

`community-avatars/<your-user-id>/<community-id>/<random-file>.<ext>`

The browser validates image type and a 5 MB size limit. The database update is still protected by the `update_community()` SECURITY DEFINER function, which only allows the community creator to attach the uploaded URL to their own community.

## Community workspace
The workspace now has functional tabs:

- Chat — realtime channel chat
- Posts — community posts stored in `community_posts`
- Members — live community membership list
- Projects — projects linked to the community
- Events — database-backed community events
- About — community description, rules, skills and location

Default channels are stored in `community_channels` and legacy messages are assigned to `#general`.

## Performance changes

- Switching channels refreshes only the chat instead of rebuilding the complete page.
- Community logo preview appears before upload.
- Save/create buttons lock while a request is running.
- Community data is loaded in parallel where possible.
- Realtime community messages update the active chat.


## V8 workspace
- Community workspace header is chat-only.
- Community head can create channels with the + button.
- Users can unsend their own messages.
- Per-user chat history can be cleared from chat settings.
- Direct and community chats support file attachments and browser voice notes.
- Added message-media storage and RLS.
