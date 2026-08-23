# Live Coders v20.6

Live Coders is a dark-mode social platform for developers, founders and traders to connect, publish, build communities and share projects.

## v20.6 Creator Studio
- New 16:9 desktop Creator Studio inspired by the approved Live Coders design.
- Side-by-side Post, Blog and Reel creation workflows.
- One-page content publishes as a Post; 2+ pages automatically publish as a Blog.
- Multiple images can be added to each Post/Blog page.
- Reel video upload with local preview.
- Preview/details/publish steps in the creator workspace.
- Responsive stacked creator workflow on tablet/mobile.
- Dark theme throughout.
- Landing page copyright: © 2026 Live Coders. All rights reserved.

## Setup
1. Open the project folder.
2. Configure the Supabase project in `js/supabaseClient.js`.
3. Apply the SQL migrations in `database/` in order if your database is not already up to date.
4. Serve the project with a local web server (for example VS Code Live Server).

## Important
Storage bucket `post-media` must allow the authenticated upload flow used by the application.
