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

## V12 product upgrade

### Supabase migration
Run `database/V12_social_content.sql` once in the Supabase SQL Editor after the existing V11 migration. This adds blog/reel post fields and the public `post-media` storage bucket.

### Authentication
Live Coders V13 uses email/password authentication in the product UI. Google sign-in has been removed from the interface. If the Google provider is enabled in Supabase Auth and you do not want it available through any other client, disable the Google provider there as well.

### New UX
- Dark/light theme toggle with persistent preference.
- Profile menu in the top-right corner.
- Community overview page before entering the workspace.
- Join/Open behavior prevents duplicate Join buttons for existing members.
- Expanded community categories and filters.
- Responsive community/profile/feed layouts for desktop, tablet and mobile.
- Blog posts support multiple pages using `---PAGE---` separators.
- Build reels support uploaded video media.
- Feed personalization is automatic: searches, post opens, categories, communities and other product interactions generate lightweight interest signals. No interest questionnaire is shown.
- `database/V13_product_upgrade.sql` adds optional server-side interest signals so personalization can persist across devices.
- Direct messages support unsending your own messages; sending refreshes only the message list instead of rebuilding the entire messages page.
- Added a public SEO-ready landing page before authentication.
- Community creators choose a predefined community type such as Startups & Founders, AI & Machine Learning, Web Development, Cybersecurity, Open Source and more.
- The light theme uses a softer, low-glare neutral palette instead of a bright white interface.

## V14 — Blogs, image galleries, mentions and friend-first feed

Run `database/V14_social_graph_and_blogs.sql` after the V13 migration.

V14 adds:
- Multi-page blog posts inside the normal feed.
- Multiple images per blog page with no per-image captions.
- Horizontal image galleries with previous/next controls and touch scrolling on mobile.
- People tagging in posts, blogs and reels.
- Automatic mention notifications.
- Friend-circle ranking using mutual follows.
- Engagement + freshness ranking so useful content can gradually spread beyond the author's friend circle.
- Blogs and reels remain posts in one unified feed; there are no separate blog/reel feeds.


## V18 updates
- Global top search searches developers, posts and communities.
- Search results are cached briefly and community catalog is cached to reduce repeated requests.
- Home feed loads fewer posts and batches the current user's likes instead of making one like query per post.
- Community recruitment now has three modes: Open, Application, Closed.
- Open recruitment uses a secure Supabase RPC for instant joining.
- Application recruitment shows only pending applications to the community head and supports accept/deny.
- Rejected/withdrawn applications can be submitted again.
- Added Trading & Finance as a community category.
