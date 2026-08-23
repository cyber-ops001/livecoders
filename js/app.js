import { supabase } from "./supabaseClient.js";

const state = {
  session: null,
  profile: null,
  route: "home",
  selectedConversation: null,
  notifications: [],
  searchTimer: null,
  realtime: null,
  selectedCommunityChannel: null,
  contentPrefs: JSON.parse(
    localStorage.getItem("livecoders-content-prefs") || "{}",
  ),
  messageDrafts: {},
  publicAuthMode: "login",
  cache: {
    communities: { data: null, at: 0 },
    search: new Map(),
  },
};

const app = document.querySelector("#app");
const esc = (v = "") =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[c],
  );
const initials = (name = "?") =>
  String(name)
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toUpperCase() || "?";
const timeAgo = (v) =>
  v
    ? new Date(v).toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "";
const signalQueue = new Map();
function trackInterest(type, value) {
  if (!value) return;
  const key = String(value).toLowerCase().trim();
  if (!key) return;
  state.contentPrefs[key] = (state.contentPrefs[key] || 0) + 1;
  state.contentPrefs[`__${type}`] = (state.contentPrefs[`__${type}`] || 0) + 1;
  localStorage.setItem(
    "livecoders-content-prefs",
    JSON.stringify(state.contentPrefs),
  );
  if (state.session) {
    const qKey = `${type}:${key}`;
    signalQueue.set(qKey, (signalQueue.get(qKey) || 0) + 1);
    clearTimeout(trackInterest.flushTimer);
    trackInterest.flushTimer = setTimeout(async () => {
      const batch = [...signalQueue.entries()];
      signalQueue.clear();
      for (const [compound, count] of batch) {
        const [signalType, signalValue] = compound.split(":");
        try {
          await supabase.rpc("record_interest_signal", {
            signal_type_input: signalType,
            signal_value_input: signalValue,
            weight_input: Math.min(count, 10),
          });
        } catch (_e) {
          /* optional V13 analytics RPC; local ranking still works */
        }
      }
    }, 900);
  }
}
function recommendationScore(p) {
  const text = [p.title, p.content, p.category, ...(p.tags || [])]
    .join(" ")
    .toLowerCase();
  let score = 0;
  for (const [k, v] of Object.entries(state.contentPrefs)) {
    if (k.startsWith("__")) continue;
    if (text.includes(k)) score += Math.min(8, v);
  }
  return score;
}
const image = (url, name, cls = "avatar") =>
  url
    ? `<img class="${cls}" src="${esc(url)}" alt="${esc(name || "Profile picture")}">`
    : `<div class="${cls}">${esc(initials(name))}</div>`;
const empty = (title, text) =>
  `<div class="emptyState"><div class="emptyIcon">&gt;_</div><h2>${esc(title)}</h2><p>${esc(text)}</p></div>`;

function toast(message, type = "info") {
  const root = document.querySelector("#toastRoot");
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

async function profile(id = state.session?.user?.id) {
  if (!id) return null;
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) console.error(error);
  if (id === state.session?.user?.id) state.profile = data;
  return data;
}

async function loadInterestSignals() {
  if (!state.session) return;
  try {
    const { data, error } = await supabase
      .from("user_interest_signals")
      .select("signal_type,signal_value,score")
      .eq("user_id", state.session.user.id)
      .order("score", { ascending: false })
      .limit(100);
    if (error) return;
    for (const row of data || []) {
      const k = String(row.signal_value || "").toLowerCase();
      if (k)
        state.contentPrefs[k] = Math.max(
          state.contentPrefs[k] || 0,
          Math.min(100, row.score || 0),
        );
    }
    localStorage.setItem(
      "livecoders-content-prefs",
      JSON.stringify(state.contentPrefs),
    );
  } catch (_e) {}
}

async function bootstrap() {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  state.session = session;
  if (!session)
    return location.hash === "#login" || location.hash === "#signup"
      ? renderAuth(location.hash.slice(1))
      : renderLanding();
  document.documentElement.dataset.public = "";
  await Promise.all([profile(), loadInterestSignals(), loadNotifications()]);
  renderShell();
  await navigate(location.hash.slice(1) || "home");
  subscribeRealtime();
}

supabase.auth.onAuthStateChange(async (_event, session) => {
  state.session = session;
  if (session) {
    document.documentElement.dataset.public = "";
    await Promise.all([profile(), loadInterestSignals(), loadNotifications()]);
    renderShell();
    await navigate(location.hash.slice(1) || "home");
    subscribeRealtime();
  } else {
    state.profile = null;
    renderLanding();
  }
});

function renderLanding() {
  document.documentElement.dataset.public = "landing";
  app.innerHTML = `<main class="landingPage">
    <nav class="landingNav">
      <button class="landingBrand" onclick="renderLanding()"><img src="assets/live-coders-logo.svg" alt="Live Coders"><span><strong>Live Coders</strong><small>Build • Ask • Connect</small></span></button>
      <div class="landingNavLinks"><a href="#features">Features</a><a href="#communities">Communities</a><a href="#builders">For builders</a></div>
      <div class="landingNavActions"><button class="landingLogin" onclick="showAuth('login')">Log in</button><button class="primary landingSignup" onclick="showAuth('signup')">Create account</button></div>
    </nav>
    <section class="landingHero">
      <div class="landingHeroCopy">
        <div class="eyebrow">THE SOCIAL NETWORK FOR BUILDERS</div>
        <h1>Build in public.<br><span>Connect with people who build.</span></h1>
        <p>Live Coders is a developer-first network for sharing projects, solving problems, joining focused communities, publishing build stories and meeting the people behind the code.</p>
        <div class="landingCtas"><button class="primary landingCta" onclick="showAuth('signup')">Start building free →</button><button class="landingGhost" onclick="showAuth('login')">I already have an account</button></div>
        <div class="landingProof"><span>✓ Developer communities</span><span>✓ Projects & blogs</span><span>✓ Build reels</span><span>✓ Direct messages</span></div>
      </div>
      <div class="landingVisual" aria-label="Live Coders product preview">
        <div class="landingWindow">
          <div class="windowTop"><span></span><span></span><span></span><b>Live Coders</b></div>
          <div class="windowBody"><aside><strong>Live Coders</strong><small>Build • Ask • Connect</small><i>⌂ Home</i><i>⌕ Explore</i><i>◈ Communities</i><i>✉ Messages</i></aside><div class="windowFeed"><div class="miniSearch">⌕ Search developers, posts, communities…</div><div class="miniHero"><span class="miniLogo">&lt;/&gt;</span><div><b>What are you building?</b><small>Discover developers and ideas matched to what you actually engage with.</small></div></div><div class="miniPost"><div class="miniAvatar">BD</div><div><b>Building a real-time developer community</b><small>Web Development · Project Showcase</small><p>Sharing progress, lessons and the next thing I’m shipping.</p><div class="miniTags"><span>#webdev</span><span>#startup</span><span>#supabase</span></div></div></div><div class="miniRow"><span>◈</span><div><b>Popular communities</b><small>AI • Startups • Web • Mobile • Open Source</small></div></div></div></div>
        </div>
      </div>
    </section>
    <section class="landingStats"><div><b>Build</b><span>Share what you're making</span></div><div><b>Connect</b><span>Meet developers with shared momentum</span></div><div><b>Grow</b><span>Learn through communities and conversations</span></div></section>
    <section id="features" class="landingSection"><div class="landingSectionHead"><div class="eyebrow">ONE PLACE TO BUILD</div><h2>Everything a developer community needs.</h2><p>Designed around builders instead of endless noise.</p></div><div class="landingFeatureGrid"><article><span>01</span><h3>Smart developer feed</h3><p>Your feed learns from searches, communities, posts and creators you interact with. No interest questionnaire.</p></article><article><span>02</span><h3>Focused communities</h3><p>Join communities by type — Startups, AI/ML, Web Development, Cybersecurity, Open Source and more.</p></article><article><span>03</span><h3>Build stories</h3><p>Publish quick posts, long-form multi-page blogs or short build reels showing what you are shipping.</p></article><article><span>04</span><h3>Real conversations</h3><p>Use community channels and direct messages to ask questions, collaborate and share progress.</p></article><article><span>05</span><h3>Developer profiles</h3><p>Show projects, skills, experience and the work you are actually building.</p></article><article><span>06</span><h3>Made for every screen</h3><p>A responsive interface that adapts cleanly from phones to large desktop displays.</p></article></div></section>
    <section id="communities" class="landingDarkSection"><div class="landingSectionHead"><div class="eyebrow">FIND YOUR PEOPLE</div><h2>Communities with a purpose.</h2><p>Every community chooses its own category, rules and focus.</p></div><div class="landingCategoryGrid">${["Startups & Founders", "AI & Machine Learning", "Web Development", "Mobile Development", "Cybersecurity", "Cloud & DevOps", "Game Development", "Open Source", "UI/UX & Design", "Blockchain & Web3", "Programming Languages", "Career & Jobs", "Trading & Finance"].map((x) => `<span>${esc(x)}</span>`).join("")}</div></section>
    <section id="builders" class="landingSection landingBuilder"><div><div class="eyebrow">FOR PEOPLE WHO SHIP</div><h2>Stop building alone.</h2><p>Find the right community, share the next version, ask for help and keep the momentum going.</p></div><button class="primary landingCta" onclick="showAuth('signup')">Join Live Coders →</button></section>
    <footer class="landingFooter"><span>© ${new Date().getFullYear()} Live Coders</span><span>Build. Ask. Connect. Solve.</span></footer>
  </main>`;
}

function renderAuth(mode = "login") {
  document.documentElement.dataset.public = "auth";
  state.publicAuthMode = mode === "signup" ? "signup" : "login";
  app.innerHTML = `<main class="authPage"><button class="authBack" onclick="renderLanding()">← Back to Live Coders</button><section class="authHero"><img class="authLogo" src="assets/live-coders-logo.svg" alt="Live Coders logo"><div class="eyebrow">DEVELOPER NETWORK</div><h1>Live Coders</h1><p>Build. Get stuck. Ask. Connect. Solve.</p><div class="codeLine"><span>const</span> community = <b>"builders"</b>;</div><div class="authFeatureList"><span>✓ Developer communities</span><span>✓ Project & blog publishing</span><span>✓ Build reels and collaboration</span></div></section><section class="authCard"><div class="tabs"><button class="tab ${state.publicAuthMode === "login" ? "active" : ""}" data-auth="login">Log in</button><button class="tab ${state.publicAuthMode === "signup" ? "active" : ""}" data-auth="signup">Create account</button></div><div class="authDivider"><span>Use your email</span></div><form id="authForm"><div id="signupFields" class="${state.publicAuthMode === "signup" ? "" : "hidden"}"><label>Full name<input name="fullName" autocomplete="name"></label><label>Username<input name="username" autocomplete="username"></label></div><label>Email<input name="email" type="email" required autocomplete="email"></label><label>Password<input name="password" type="password" required minlength="6" autocomplete="current-password"></label><div id="confirmField" class="${state.publicAuthMode === "signup" ? "" : "hidden"}"><label>Confirm password<input name="confirmPassword" type="password" minlength="6" autocomplete="new-password"></label></div><button class="primary full" id="authSubmit">${state.publicAuthMode === "signup" ? "Create account" : "Log in"}</button><button class="linkButton ${state.publicAuthMode === "signup" ? "hidden" : ""}" type="button" id="forgotBtn">Forgot password?</button></form></section></main>`;
  let modeNow = state.publicAuthMode;
  document.querySelectorAll("[data-auth]").forEach(
    (btn) =>
      (btn.onclick = () => {
        modeNow = btn.dataset.auth;
        state.publicAuthMode = modeNow;
        document
          .querySelectorAll("[data-auth]")
          .forEach((x) => x.classList.toggle("active", x === btn));
        document
          .querySelector("#signupFields")
          .classList.toggle("hidden", modeNow !== "signup");
        document
          .querySelector("#confirmField")
          .classList.toggle("hidden", modeNow !== "signup");
        document.querySelector("#authSubmit").textContent =
          modeNow === "signup" ? "Create account" : "Log in";
        document
          .querySelector("#forgotBtn")
          .classList.toggle("hidden", modeNow === "signup");
      }),
  );
  document.querySelector("#authForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      if (modeNow === "signup") {
        if (f.get("password") !== f.get("confirmPassword"))
          throw new Error("Passwords do not match.");
        const fullName = String(f.get("fullName") || "")
          .trim()
          .replace(/\s+/g, " ");
        const username = String(f.get("username") || "")
          .trim()
          .toLowerCase();
        if (!fullName || fullName.length < 2)
          throw new Error("Enter your full name.");
        if (!/^[a-z0-9_]{3,30}$/.test(username))
          throw new Error("Username must be 3–30 characters.");
        const { data: takenUsername, error: usernameError } = await supabase
          .from("profiles")
          .select("id")
          .eq("username", username)
          .maybeSingle();
        if (usernameError) throw usernameError;
        if (takenUsername) throw new Error("Username already taken.");
        const redirectTo =
          location.origin && location.origin !== "null"
            ? `${location.origin}/`
            : "http://localhost:5500/";
        const { data, error } = await supabase.auth.signUp({
          email: f.get("email"),
          password: f.get("password"),
          options: {
            data: { fullName, username },
            emailRedirectTo: redirectTo,
          },
        });
        if (error) throw error;
        if (data.session) {
          toast("Account created. Welcome to Live Coders!", "success");
          return;
        }
        document.querySelector("#authSubmit").textContent = "Account created";
        toast(
          "Account created. Check your email to verify it, then return here to log in.",
          "success",
        );
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: f.get("email"),
          password: f.get("password"),
        });
        if (error) throw error;
      }
    } catch (err) {
      toast(err.message, "error");
    }
  };
  document.querySelector("#forgotBtn").onclick = async () => {
    const email = document.querySelector('input[name="email"]').value.trim();
    if (!email) return toast("Enter your email first.", "error");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: location.origin,
    });
    toast(
      error?.message || "Password reset email sent.",
      error ? "error" : "success",
    );
  };
}
window.showAuth = (mode = "login") => renderAuth(mode);

function navItem(route, icon, label, badge = 0) {
  return `<a href="#${route}" data-route="${route}"><span>${icon}</span>${label}${badge ? `<b class="navBadge">${badge}</b>` : ""}</a>`;
}

function renderShell() {
  const avatar = state.profile?.avatar_url;
  const display =
    state.profile?.display_name ||
    state.profile?.full_name ||
    state.profile?.username ||
    "Developer";
  app.innerHTML = `<div class="layout"><aside class="sidebar"><div class="brand" onclick="location.hash='home'"><img class="brandLogo" src="assets/live-coders-logo.svg" alt=""><div class="brandText"><strong>Live Coders</strong><small>Build • Ask • Connect</small></div></div><nav>${navItem("home", "⌂", "Home")}${navItem("explore", "⌕", "Explore")}${navItem("communities", "◈", "Communities")}${navItem("myCommunities", "▣", "My Communities")}${navItem("messages", "✉", "Messages")}${navItem("notifications", "●", "Notifications", unreadNotificationCount())}${navItem("profile", "◎", "Profile")}${navItem("settings", "⚙", "Settings")}</nav><div class="sidebarBottom"><button class="ghost full" id="logoutBtn">Log out</button></div></aside><div class="mainArea"><header class="topbar"><div class="mobileBrand"><img class="brandLogo small" src="assets/live-coders-logo.svg" alt=""><strong>Live Coders</strong></div><div class="globalSearch"><span>⌕</span><input id="globalSearch" value="${esc(new URLSearchParams(location.hash.split("?")[1] || "").get("q") || "")}" placeholder="Search developers, posts, communities…"></div><div class="topActions"><button class="notificationBtn" onclick="location.hash='notifications'" aria-label="Notifications" title="Notifications"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path></svg><b id="notifBadge" class="notificationBadge ${unreadNotificationCount() ? "" : "hidden"}">${unreadNotificationCount()}</b></button><button class="primary" onclick="openPostModal()">+ Create Post</button><button class="topProfile" id="topProfileBtn" aria-label="Open profile">${image(avatar, display, "avatar small")}<span><strong>${esc(display)}</strong><small>@${esc(state.profile?.username || "")}</small></span><span>⌄</span></button><div class="profileMenu hidden" id="profileMenu"><button onclick="location.hash='profile'">View profile</button><button onclick="location.hash='settings'">Settings</button><button id="menuLogout">Log out</button></div></div></header><main id="page"></main></div></div>`;
  document.querySelector("#logoutBtn").onclick = () => supabase.auth.signOut();
  document.querySelector("#menuLogout").onclick = () => supabase.auth.signOut();
  document.querySelector("#topProfileBtn").onclick = () =>
    document.querySelector("#profileMenu")?.classList.toggle("hidden");
  document.addEventListener(
    "click",
    (e) => {
      const m = document.querySelector("#profileMenu"),
        b = document.querySelector("#topProfileBtn");
      if (m && !m.contains(e.target) && b && !b.contains(e.target))
        m.classList.add("hidden");
    },
    { once: true },
  );
  const search = document.querySelector("#globalSearch");
  const runGlobalSearch = () => {
    clearTimeout(state.searchTimer);
    const q = search.value.trim();
    if (q) trackInterest("search", q);
    location.hash = q ? `explore?q=${encodeURIComponent(q)}` : "explore";
  };
  search.oninput = () => {
    clearTimeout(state.searchTimer);
    const q = search.value.trim();
    if (!q) return;
    state.searchTimer = setTimeout(runGlobalSearch, 500);
  };
  search.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runGlobalSearch();
    }
  };
}
async function navigate(raw) {
  const [route] = raw.split("?");
  state.route = route || "home";
  const page = document.querySelector("#page");
  if (!page) return;
  document
    .querySelectorAll("[data-route]")
    .forEach((a) =>
      a.classList.toggle("active", a.dataset.route === state.route),
    );
  const query = new URLSearchParams(raw.split("?")[1] || "");
  try {
    if (state.route === "home") await renderHome(page);
    else if (state.route === "explore")
      await renderExplore(page, query.get("q") || "");
    else if (state.route === "communities") await renderCommunities(page);
    else if (state.route === "myCommunities") await renderMyCommunities(page);
    else if (state.route === "messages") {
      state.selectedConversation = query.get("conversation");
      await renderMessages(page);
    } else if (state.route === "notifications") await renderNotifications(page);
    else if (state.route === "profile")
      await renderProfile(page, state.session.user.id);
    else if (state.route === "user") await renderProfile(page, query.get("id"));
    else if (state.route === "community")
      await renderCommunityOverview(page, query.get("id"));
    else if (state.route === "communityChat")
      await renderCommunityWorkspace(page, query.get("id"));
    else if (state.route === "settings") await renderSettings(page);
    else await renderHome(page);
  } catch (e) {
    console.error(e);
    page.innerHTML = `<div class="errorState"><h2>Something went wrong</h2><p>${esc(e.message)}</p></div>`;
  }
}
window.addEventListener("hashchange", () => navigate(location.hash.slice(1)));

function engagementScore(p) {
  const ageHours = Math.max(
    0,
    (Date.now() - new Date(p.created_at || Date.now()).getTime()) / 3600000,
  );
  const freshness = Math.max(0, 48 - ageHours) / 48;
  const engagement =
    Number(p.like_count || 0) * 3 +
    Number(p.comment_count || 0) * 5 +
    Number(p.view_count || 0) * 0.35;
  return Math.min(40, engagement / 10) + freshness * 18;
}

async function getPosts(filter = {}) {
  let q = supabase
    .from("posts")
    .select(
      "*,author:profiles!posts_author_id_fkey(id,username,display_name,full_name,avatar_url)",
    )
    .order("created_at", { ascending: false })
    .limit(40);
  if (filter.author) q = q.eq("author_id", filter.author);
  const { data, error } = await q;
  if (error) throw error;
  const posts = data || [];
  if (posts.length && state.session?.user?.id) {
    const { data: likedRows } = await supabase
      .from("post_likes")
      .select("post_id")
      .eq("user_id", state.session.user.id)
      .in(
        "post_id",
        posts.map((p) => p.id),
      );
    const likedSet = new Set((likedRows || []).map((x) => x.post_id));
    posts.forEach((p) => {
      p._liked = likedSet.has(p.id);
    });
  }
  let friendIds = new Set();
  if (!filter.author) {
    const [{ data: following }, { data: followers }] = await Promise.all([
      supabase
        .from("follows")
        .select("following_id")
        .eq("follower_id", state.session.user.id)
        .limit(300),
      supabase
        .from("follows")
        .select("follower_id")
        .eq("following_id", state.session.user.id)
        .limit(300),
    ]);
    const followingIds = new Set((following || []).map((x) => x.following_id));
    (followers || []).forEach((x) => {
      if (followingIds.has(x.follower_id)) friendIds.add(x.follower_id);
    });
  }
  return posts.sort((a, b) => {
    const score = (p) =>
      recommendationScore(p) +
      engagementScore(p) +
      (friendIds.has(p.author_id) ? 16 : 0);
    return score(b) - score(a);
  });
}

function renderBlogGallery(pages = []) {
  if (!pages.length) return "";
  return `<div class="blogPages">${pages
    .map((page, i) => {
      const imgs = Array.isArray(page?.images) ? page.images : [];
      const text = typeof page === "string" ? page : String(page?.text || "");
      return `<section class="blogPage"><div class="blogPageHeader"><span class="pageNo">Page ${i + 1}</span><div class="blogPager"><button type="button" onclick="this.closest('.blogPage').querySelector('.blogImageStrip').scrollBy({left:-320,behavior:'smooth'})" aria-label="Previous images">‹</button><button type="button" onclick="this.closest('.blogPage').querySelector('.blogImageStrip').scrollBy({left:320,behavior:'smooth'})" aria-label="Next images">›</button></div></div>${text ? `<p>${esc(text)}</p>` : ""}${imgs.length ? `<div class="blogImageStrip">${imgs.map((src, j) => `<img loading="lazy" src="${esc(src)}" alt="${esc(p.title || "Blog image")} ${j + 1}">`).join("")}</div>` : ""}</section>`;
    })
    .join("")}</div>`;
}

async function postCard(p) {
  trackInterest("category", p.category || "");
  (p.tags || []).slice(0, 5).forEach((t) => trackInterest("topic", t));
  const liked =
    p._liked !== undefined
      ? p._liked
      : !!(
          await supabase
            .from("post_likes")
            .select("post_id")
            .eq("post_id", p.id)
            .eq("user_id", state.session.user.id)
            .maybeSingle()
        ).data;
  const author = p.author || {};
  const pages = Array.isArray(p.body_pages) ? p.body_pages : [];
  const type =
    p.post_type === "reel"
      ? "reel"
      : pages.length > 1 || p.post_type === "blog"
        ? "blog"
        : "post";
  const media = p.media_url
    ? `<div class="postMedia">${String(p.media_type || "").startsWith("video") || type === "reel" ? `<video controls preload="metadata" src="${esc(p.media_url)}"></video>` : `<img loading="lazy" src="${esc(p.media_url)}" alt="${esc(p.title || "Post media")}">`}</div>`
    : "";
  const blog = type === "blog" ? renderBlogGallery(pages) : "";
  const singlePageImages =
    type === "post" && pages[0]?.images?.length
      ? `<div class="postImageStrip">${pages[0].images.map((src, j) => `<img loading="lazy" src="${esc(src)}" alt="${esc(p.title || "Post image")} ${j + 1}">`).join("")}</div>`
      : "";
  const textContent =
    type === "blog"
      ? ""
      : p.content
        ? `<p class="postContent">${esc(p.content)}</p>`
        : "";
  const kindLabel =
    type === "blog" ? "BLOG" : type === "reel" ? "REEL" : "POST";
  const ownActions =
    p.author_id === state.session.user.id
      ? `<button class="postDeleteBtn" onclick="deletePost('${p.id}')" aria-label="Delete post">Delete</button>`
      : "";
  return `<article class="postCard ${type === "reel" ? "reelCard" : ""}"><div class="postHeader"><div class="postAuthor" onclick="location.hash='user?id=${p.author_id}'">${image(author.avatar_url, author.display_name || author.full_name || author.username)}<div><strong>${esc(author.display_name || author.full_name || author.username || "Developer")}</strong><small>@${esc(author.username || "")} · ${timeAgo(p.created_at)}</small></div></div><div class="postHeaderActions"><span class="postKind ${type}">${kindLabel}</span>${ownActions}</div></div><h2>${esc(p.title)}</h2>${textContent}${blog}${singlePageImages}${media}<div class="tags">${(p.tags || []).map((t) => `<span class="tag">#${esc(t)}</span>`).join("")}</div><div class="postMeta"><button onclick="toggleLike('${p.id}',${!!liked})">${liked ? "♥" : "♡"} ${p.like_count || 0}</button><button onclick="openComments('${p.id}')">💬 ${p.comment_count || 0}</button><button onclick="viewPost('${p.id}')">👁 ${p.view_count || 0}</button><button onclick="location.hash='user?id=${p.author_id}'">Profile</button></div></article>`;
}

async function deletePost(postId) {
  const { data: post, error: fetchError } = await supabase
    .from("posts")
    .select("id,author_id,title")
    .eq("id", postId)
    .maybeSingle();
  if (fetchError) return toast(fetchError.message, "error");
  if (!post || post.author_id !== state.session.user.id)
    return toast("You can only delete your own posts.", "error");
  if (
    !confirm(
      `Delete "${post.title || "this post"}"?\n\nThis will remove the post and its comments. This cannot be undone.`,
    )
  )
    return;
  const { error } = await supabase
    .from("posts")
    .delete()
    .eq("id", postId)
    .eq("author_id", state.session.user.id);
  if (error) return toast(error.message, "error");
  toast("Post deleted.", "success");
  if (state.route === "home") await renderHome(document.querySelector("#page"));
  else if (state.route === "profile" || state.route === "user")
    await navigate(location.hash.slice(1));
}
window.deletePost = deletePost;

async function renderHome(page) {
  page.innerHTML = `<div class="pageHead"><div><div class="eyebrow">YOUR BUILDER FEED</div><h1>What are you building?</h1><p>Your feed is automatically ranked from the developers, communities and topics you engage with.</p></div><button class="primary createPostHeroBtn" onclick="openPostModal()">+ Create Post</button></div><div class="feedLayout"><section><div id="feedList">Loading posts…</div></section><aside class="rightRail"><div class="card"><h3>Quick actions</h3><button class="railAction" onclick="openPostModal()">+ Create a post</button><button class="railAction" onclick="openPostModal('reel')">▶ Post a build reel</button><button class="railAction" onclick="location.hash='explore'">⌕ Explore developers</button><button class="railAction" onclick="location.hash='communities'">◈ Find communities</button></div><div class="card automatedFeedCard"><h3>Personalized automatically</h3><p class="muted">Your feed quietly adapts to what you search, open, like and discuss. You never need to choose interests manually.</p><div class="autoSignal"><span>●</span> Learning from your activity</div></div></aside></div>`;
  const posts = await getPosts();
  const list = document.querySelector("#feedList");
  list.innerHTML = posts.length
    ? (await Promise.all(posts.map(postCard))).join("")
    : empty("No posts yet", "Be the first developer to publish something.");
}
async function toggleLike(postId, liked) {
  const post = await supabase
    .from("posts")
    .select("author_id,title")
    .eq("id", postId)
    .single();
  if (post.error) return toast(post.error.message, "error");
  const res = liked
    ? await supabase
        .from("post_likes")
        .delete()
        .eq("post_id", postId)
        .eq("user_id", state.session.user.id)
    : await supabase
        .from("post_likes")
        .insert({ post_id: postId, user_id: state.session.user.id });
  if (res.error) toast(res.error.message, "error");
  else {
    if (state.route === "home") navigate("home");
    else if (state.route === "user") navigate(location.hash.slice(1));
  }
}
window.toggleLike = toggleLike;

async function openComments(postId) {
  const { data: comments, error } = await supabase
    .from("post_comments")
    .select(
      "*,author:profiles!post_comments_author_id_fkey(id,username,display_name,full_name,avatar_url)",
    )
    .eq("post_id", postId)
    .order("created_at", { ascending: true });
  if (error) return toast(error.message, "error");
  const { data: likes } = await supabase
    .from("comment_likes")
    .select("comment_id")
    .in("comment_id", (comments || []).map((c) => c.id).filter(Boolean))
    .eq("user_id", state.session.user.id);
  const likedSet = new Set((likes || []).map((x) => x.comment_id));
  const byParent = {};
  (comments || []).forEach((c) => {
    (byParent[c.parent_id || "root"] ||= []).push(c);
  });
  const renderComment = (c, depth = 0) => {
    const replies = byParent[c.id] || [];
    return `<div class="comment ${depth ? "replyComment" : ""}" style="margin-left:${Math.min(depth, 3) * 24}px"><button class="commentAuthor" onclick="closeModal();location.hash='user?id=${c.author_id}'">${image(c.author?.avatar_url, c.author?.display_name || c.author?.full_name || c.author?.username, "avatar small")}<span><b>${esc(c.author?.display_name || c.author?.full_name || c.author?.username)}</b><small>@${esc(c.author?.username || "")} · ${timeAgo(c.created_at)}</small></span></button><p>${esc(c.content)}</p><div class="commentActions"><button onclick="toggleCommentLike('${c.id}',${likedSet.has(c.id)},'${postId}')">${likedSet.has(c.id) ? "♥" : "♡"} ${c.like_count || 0}</button><button onclick="replyToComment('${c.id}')">↩ Reply</button></div>${replies.map((r) => renderComment(r, depth + 1)).join("")}</div>`;
  };
  modal(
    `<h2>Comments</h2><div class="commentList">${(byParent.root || []).map((c) => renderComment(c)).join("") || `<p class="muted">No comments yet.</p>`}</div><form id="commentForm"><label>Add a comment<textarea name="content" rows="3" required></textarea></label><input type="hidden" name="parentId"><button class="primary full">Comment</button></form>`,
  );
  document.querySelector("#commentForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const content = String(f.get("content")).trim();
    const parentId = f.get("parentId") || null;
    const { error } = await supabase
      .from("post_comments")
      .insert({
        post_id: postId,
        author_id: state.session.user.id,
        parent_id: parentId,
        content,
      });
    if (error) toast(error.message, "error");
    else {
      closeModal();
      toast(parentId ? "Reply added." : "Comment added.", "success");
      await openComments(postId);
    }
  };
}
async function toggleCommentLike(commentId, liked, postId) {
  const res = liked
    ? await supabase
        .from("comment_likes")
        .delete()
        .eq("comment_id", commentId)
        .eq("user_id", state.session.user.id)
    : await supabase
        .from("comment_likes")
        .insert({ comment_id: commentId, user_id: state.session.user.id });
  if (res.error) toast(res.error.message, "error");
  else openComments(postId);
}
window.toggleCommentLike = toggleCommentLike;
function replyToComment(commentId) {
  const input = document.querySelector('#commentForm input[name="parentId"]');
  if (input) input.value = commentId;
  document.querySelector("#commentForm textarea")?.focus();
}
window.replyToComment = replyToComment;
window.openComments = openComments;
async function viewPost(id) {
  await supabase.rpc("record_post_view", { post_id_input: id });
}
window.viewPost = viewPost;

async function fetchCommunityCatalog(force = false) {
  const now = Date.now();
  if (
    !force &&
    state.cache.communities.data &&
    now - state.cache.communities.at < 30000
  )
    return state.cache.communities.data;
  const { data, error } = await supabase
    .from("communities")
    .select(
      "id,name,description,logo_url,category,member_count,view_count,recruitment_enabled,recruitment_mode,location,remote_mode,creator_id",
    )
    .order("member_count", { ascending: false })
    .limit(60);
  if (error) throw error;
  state.cache.communities = { data: data || [], at: now };
  return data || [];
}

async function searchAll(q) {
  const term = String(q || "").trim();
  if (!term) return { users: [], posts: [], communities: [] };
  const key = term.toLowerCase();
  const cached = state.cache.search.get(key);
  if (cached && Date.now() - cached.at < 15000) return cached.data;
  const like = `%${term.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const [users, posts, communities] = await Promise.all([
    supabase
      .from("profiles")
      .select(
        "id,username,display_name,full_name,avatar_url,bio,skills,location",
      )
      .or(
        `username.ilike.${like},display_name.ilike.${like},full_name.ilike.${like},bio.ilike.${like},location.ilike.${like}`,
      )
      .limit(20),
    supabase
      .from("posts")
      .select(
        "id,title,content,category,post_type,created_at,author_id,like_count,comment_count,view_count,author:profiles!posts_author_id_fkey(id,username,display_name,full_name,avatar_url)",
      )
      .or(`title.ilike.${like},content.ilike.${like},category.ilike.${like}`)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("communities")
      .select(
        "id,name,description,logo_url,category,member_count,view_count,recruitment_enabled,recruitment_mode,location,remote_mode,creator_id",
      )
      .or(
        `name.ilike.${like},description.ilike.${like},category.ilike.${like},location.ilike.${like}`,
      )
      .order("member_count", { ascending: false })
      .limit(20),
  ]);
  const error = users.error || posts.error || communities.error;
  if (error) throw error;
  const data = {
    users: users.data || [],
    posts: posts.data || [],
    communities: communities.data || [],
  };
  state.cache.search.set(key, { data, at: Date.now() });
  return data;
}

async function renderExplore(page, q = "") {
  const [communities, members] = await Promise.all([
    fetchCommunityCatalog(),
    supabase
      .from("community_members")
      .select("community_id")
      .eq("user_id", state.session.user.id),
  ]);
  if (members.error)
    return (page.innerHTML = empty(
      "Could not load communities",
      members.error.message,
    ));
  let search = { users: [], posts: [], communities: [] };
  try {
    if (q) search = await searchAll(q);
  } catch (error) {
    return (page.innerHTML = empty(
      "Search error",
      error.message || "Try again in a moment.",
    ));
  }
  if (q) trackInterest("search", q);

  const joinedIds = new Set((members.data || []).map((x) => x.community_id));
  const categoryList = [
    "Web Development",
    "Mobile Development",
    "AI & Machine Learning",
    "Data Science",
    "Cybersecurity",
    "Cloud & DevOps",
    "Game Development",
    "Blockchain & Web3",
    "Open Source",
    "UI/UX & Design",
    "Startups & Founders",
    "Programming Languages",
    "Career & Jobs",
    "Freelancing",
    "Robotics & IoT",
    "No-Code & Automation",
    "Trading & Finance",
  ];
  const dbCats = communities.map((c) => c.category).filter(Boolean);
  const categories = [...new Set([...categoryList, ...dbCats])];
  const filtered = q ? search.communities : communities;
  const popular = filtered.slice(0, 6);
  const trending = [...filtered]
    .sort((a, b) => Number(b.view_count || 0) - Number(a.view_count || 0))
    .slice(0, 8);

  page.innerHTML = `<div class="pageHead modernPageHead"><div><div class="eyebrow">DISCOVER</div><h1>${q ? `Search results for “${esc(q)}”` : "Explore Communities"}</h1><p>Find developers, posts and communities by technology, career path, project and goal.</p></div><button class="primary" onclick="openCommunityModal()">+ Create Community</button></div>
  <div class="searchBox modernSearch"><span>⌕</span><input id="communitySearch" value="${esc(q)}" placeholder="Search developers, posts, communities…"><select id="communityCategory"><option value="">All categories</option>${categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}</select></div>
  <div class="communityChips"><button class="chip active" data-category="">All</button>${categories.map((c) => `<button class="chip" data-category="${esc(c)}">${esc(c)}</button>`).join("")}</div>
  ${
    q
      ? `<section class="searchResultsGrid">
    <div class="sectionTitle"><div><h2>Developers</h2><p class="muted">${search.users.length} matches</p></div></div>
    <div class="userGrid">${search.users.map((u) => `<article class="userCard">${image(u.avatar_url, u.display_name || u.full_name || u.username, "avatar large")}<h3>${esc(u.display_name || u.full_name || u.username)}</h3><small>@${esc(u.username || "")}</small><p>${esc(u.bio || "")}</p><button class="secondary" onclick="location.hash='user?id=${u.id}'">View profile</button></article>`).join("") || empty("No developers found", "Try another search term.")}</div>
  </section>
  <section class="searchResultsGrid">
    <div class="sectionTitle"><div><h2>Posts</h2><p class="muted">${search.posts.length} matches</p></div></div>
    <div class="feedListCompact">${search.posts.map((p) => `<article class="postSearchRow"><div><b>${esc(p.title || "Untitled")}</b><small>${esc(p.category || "Developer post")} · ${timeAgo(p.created_at)}</small><p>${esc((p.content || "").slice(0, 220))}</p></div><button class="secondary" onclick="viewPost('${p.id}')">Open</button></article>`).join("") || `<p class="muted">No posts found.</p>`}</div>
  </section>`
      : ""
  }
  <section class="exploreSection communityExplore"><div class="sectionTitle"><div><h2>${q ? "Matching communities" : "Popular Communities"}</h2><p class="muted">Communities developers are joining and exploring.</p></div><button class="linkButton" onclick="location.hash='communities'">View all →</button></div><div class="communityGrid" id="popularCommunities">${popular.map((c) => communityCard(c, joinedIds)).join("") || empty("No communities", "Create the first one.")}</div></section>
  <section class="exploreSection"><div class="sectionTitle"><div><h2>Trending Communities</h2><p class="muted">Active communities getting attention right now.</p></div></div><div class="trendingCommunityList">${trending.map((c) => communityListRow(c, joinedIds)).join("") || `<p class="muted">No trending communities yet.</p>`}</div></section>`;

  const applyFilter = () => {
    const text = document.querySelector("#communitySearch").value.trim();
    const cat = document.querySelector("#communityCategory").value;
    trackInterest("category", cat);
    if (text !== q) {
      location.hash = text
        ? `explore?q=${encodeURIComponent(text)}`
        : "explore";
      return;
    }
    document
      .querySelectorAll("#popularCommunities .communityCard")
      .forEach(
        (card) =>
          (card.style.display =
            !cat || card.dataset.category === cat ? "" : "none"),
      );
  };
  const input = document.querySelector("#communitySearch");
  input.onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      applyFilter();
    }
  };
  input.oninput = () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(applyFilter, 450);
  };
  document.querySelector("#communityCategory").onchange = applyFilter;
  document.querySelectorAll(".chip").forEach(
    (ch) =>
      (ch.onclick = () => {
        document
          .querySelectorAll(".chip")
          .forEach((x) => x.classList.remove("active"));
        ch.classList.add("active");
        document.querySelector("#communityCategory").value =
          ch.dataset.category;
        applyFilter();
      }),
  );
}

function recruitmentLabel(c) {
  const mode =
    c.recruitment_mode || (!c.recruitment_enabled ? "closed" : "application");
  return mode === "open"
    ? "Open recruitment"
    : mode === "application"
      ? "Application required"
      : "Closed";
}
function communityListRow(c, joinedIds = new Set()) {
  const joined = joinedIds.has(c.id) || c._joined;
  const mode =
    c.recruitment_mode || (!c.recruitment_enabled ? "closed" : "application");
  const action = joined
    ? `<button class="primary" onclick="location.hash='communityChat?id=${c.id}'">Open</button>`
    : mode === "open"
      ? `<button class="primary" onclick="joinCommunity('${c.id}')">Join</button>`
      : mode === "application"
        ? `<button class="primary" onclick="applyCommunity('${c.id}')">Apply</button>`
        : `<button class="secondary" disabled>Closed</button>`;
  return `<article class="trendingCommunityRow">${image(c.logo_url, c.name, "communityIcon medium")}<div class="trendingCommunityInfo"><b>${esc(c.name)}</b><small>${esc(c.category || "Community")} · ${Number(c.member_count || 0).toLocaleString()} members · ${recruitmentLabel(c)}</small><p>${esc(c.description || "")}</p></div>${action}</article>`;
}
function communityCard(c, joinedIds = new Set()) {
  const joined = joinedIds.has(c.id) || c._joined;
  const mode =
    c.recruitment_mode || (!c.recruitment_enabled ? "closed" : "application");
  const action = joined
    ? `<button class="primary" onclick="location.hash='communityChat?id=${c.id}'">Open</button>`
    : mode === "open"
      ? `<button class="primary" onclick="joinCommunity('${c.id}')">Join</button>`
      : mode === "application"
        ? `<button class="primary" onclick="applyCommunity('${c.id}')">Apply to join</button>`
        : `<button class="secondary" disabled>Recruitment closed</button>`;
  return `<article class="communityCard" data-category="${esc(c.category || "")}"><div class="communityCardCover">${image(c.logo_url, c.name, "communityIcon xl")}</div><div class="communityCardBody"><span class="categoryPill">${esc(c.category || "Community")}</span><h3>${esc(c.name)}</h3><p>${esc(c.description || "Connect, share knowledge and build together.")}</p><small>${Number(c.member_count || 0).toLocaleString()} members · ${Number(c.view_count || 0).toLocaleString()} views</small><small class="recruitmentPill">${recruitmentLabel(c)}</small><div class="communityCardActions"><button class="secondary" onclick="location.hash='community?id=${c.id}'">View community</button>${action}</div></div></article>`;
}

window.joinCommunity = async function (id) {
  const { data: existing } = await supabase
    .from("community_members")
    .select("community_id")
    .eq("community_id", id)
    .eq("user_id", state.session.user.id)
    .maybeSingle();
  if (existing) return navigate(`communityChat?id=${id}`);
  const { data: community, error: communityError } = await supabase
    .from("communities")
    .select("recruitment_mode,recruitment_enabled")
    .eq("id", id)
    .single();
  if (communityError) return toast(communityError.message, "error");
  const mode =
    community.recruitment_mode ||
    (!community.recruitment_enabled ? "closed" : "application");
  if (mode === "application") return applyCommunity(id);
  if (mode === "closed")
    return toast(
      "This community is not accepting new members right now.",
      "error",
    );
  const { error } = await supabase.rpc("join_open_community", {
    community_id_input: id,
  });
  if (error) return toast(error.message, "error");
  state.cache.communities.at = 0;
  state.cache.search.clear();
  toast("Joined community.", "success");
  navigate(`communityChat?id=${id}`);
};

window.applyCommunity = async (id) => {
  const { data: community, error: communityError } = await supabase
    .from("communities")
    .select("recruitment_mode,recruitment_enabled")
    .eq("id", id)
    .single();
  if (communityError) return toast(communityError.message, "error");
  const mode =
    community.recruitment_mode ||
    (!community.recruitment_enabled ? "closed" : "application");
  if (mode === "open") return joinCommunity(id);
  if (mode === "closed")
    return toast("Recruitment is closed for this community.", "error");
  const { data: member } = await supabase
    .from("community_members")
    .select("community_id")
    .eq("community_id", id)
    .eq("user_id", state.session.user.id)
    .maybeSingle();
  if (member) return navigate(`communityChat?id=${id}`);
  const { data: existing } = await supabase
    .from("community_applications")
    .select("id,status")
    .eq("community_id", id)
    .eq("applicant_id", state.session.user.id)
    .maybeSingle();
  if (existing?.status === "pending")
    return toast("Your application is already pending.", "info");
  const { error } = existing
    ? await supabase
        .from("community_applications")
        .update({
          status: "pending",
          answers: {},
          reviewed_by: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
    : await supabase
        .from("community_applications")
        .insert({
          community_id: id,
          applicant_id: state.session.user.id,
          answers: {},
        });
  if (error) toast(error.message, "error");
  else {
    toast("Application sent.", "success");
    navigate(`community?id=${id}`);
  }
};

async function renderCommunities(page) {
  const [data, membersQ] = await Promise.all([
    fetchCommunityCatalog(),
    supabase
      .from("community_members")
      .select("community_id")
      .eq("user_id", state.session.user.id),
  ]);
  if (membersQ.error) throw membersQ.error;
  const joinedIds = new Set((membersQ.data || []).map((x) => x.community_id));
  const categories = [
    ...new Set([
      "Startups & Founders",
      "AI & Machine Learning",
      "Web Development",
      "Mobile Development",
      "Data Science",
      "Cybersecurity",
      "Cloud & DevOps",
      "Game Development",
      "Blockchain & Web3",
      "Open Source",
      "UI/UX & Design",
      "Programming Languages",
      "Career & Jobs",
      "Freelancing",
      "Robotics & IoT",
      "No-Code & Automation",
      "Trading & Finance",
      ...(data || []).map((c) => c.category).filter(Boolean),
    ]),
  ];
  page.innerHTML = `<div class="pageHead modernPageHead"><div><div class="eyebrow">COMMUNITY NETWORK</div><h1>Find your people.</h1><p>Join communities, share knowledge, collaborate and grow with developers.</p></div><button class="primary" onclick="openCommunityModal()">+ Create Community</button></div><div class="communityExplore"><div class="searchBox"><span>⌕</span><input id="allCommunitySearch" placeholder="Search communities..."><select id="allCommunityCategory"><option value="">All Categories</option>${categories.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}</select></div><div class="communityChips"><button class="chip active" data-category="">All</button>${categories.map((c) => `<button class="chip" data-category="${esc(c)}">${esc(c)}</button>`).join("")}</div><div class="communityGrid pageGrid" id="allCommunitiesGrid">${(data || []).map((c) => communityCard(c, joinedIds)).join("") || empty("No communities", "Create the first one.")}</div></div>`;
  const input = document.querySelector("#allCommunitySearch"),
    select = document.querySelector("#allCommunityCategory"),
    chips = [...document.querySelectorAll(".chip")];
  const apply = () => {
    const term = input.value.trim().toLowerCase(),
      cat = select.value;
    const rows = (data || []).filter((c) => {
      const hay =
        `${c.name || ""} ${c.description || ""} ${c.category || ""}`.toLowerCase();
      return (!term || hay.includes(term)) && (!cat || c.category === cat);
    });
    document.querySelector("#allCommunitiesGrid").innerHTML =
      rows.map((c) => communityCard(c, joinedIds)).join("") ||
      empty("No matches", "Try another search.");
    chips.forEach((b) =>
      b.classList.toggle("active", b.dataset.category === cat),
    );
  };
  input.oninput = apply;
  select.onchange = apply;
  chips.forEach(
    (b) =>
      (b.onclick = () => {
        select.value = b.dataset.category;
        apply();
      }),
  );
}

async function renderMyCommunities(page) {
  const [membersQ, createdQ] = await Promise.all([
    supabase
      .from("community_members")
      .select("community_id,community:communities(*)")
      .eq("user_id", state.session.user.id),
    supabase
      .from("communities")
      .select("*")
      .eq("creator_id", state.session.user.id),
  ]);
  if (membersQ.error || createdQ.error) throw membersQ.error || createdQ.error;
  const map = new Map();
  (membersQ.data || []).forEach((x) => {
    if (x.community) map.set(x.community.id, x.community);
  });
  (createdQ.data || []).forEach((c) => map.set(c.id, c));
  const communities = [...map.values()].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at),
  );
  page.innerHTML = `<div class="pageHead modernPageHead"><div><div class="eyebrow">MY COMMUNITIES</div><h1>Your workspace</h1><p>Everything you joined or built, in one place.</p></div><button class="primary" onclick="openCommunityModal()">+ Create Community</button></div><div class="myCommunityGrid">${communities.map((c) => `<article class="myCommunityCard" onclick="location.hash='community?id=${c.id}'"><div class="myCommunityCover" style="${c.banner_url ? `background-image:url('${esc(c.banner_url)}')` : ""}"></div><div class="myCommunityBody">${image(c.logo_url, c.name, "communityIcon")}<div class="myCommunityInfo"><h3>${esc(c.name)}</h3><p>${esc(c.description || "Build together.")}</p><div class="communityMiniMeta"><span>${c.member_count || 0} members</span><span>${c.view_count || 0} views</span><span>${esc(c.remote_mode || "Remote")}</span></div></div></div></article>`).join("") || empty("No communities yet", "Join a community from Explore or create your own.")}</div>`;
}
async function renderProfile(page, id) {
  if (!id)
    return (page.innerHTML = empty(
      "Profile not found",
      "No user was selected.",
    ));
  const p = await profile(id);
  if (!p)
    return (page.innerHTML = empty(
      "Profile not found",
      "This developer does not exist.",
    ));
  const results = await Promise.all([
    supabase
      .from("follows")
      .select("following_id", { count: "exact", head: true })
      .eq("following_id", id),
    supabase
      .from("follows")
      .select("follower_id", { count: "exact", head: true })
      .eq("follower_id", id),
    supabase
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("author_id", id),
    supabase
      .from("follows")
      .select(
        "follower_id,user:profiles!follows_follower_id_fkey(id,username,display_name,full_name,avatar_url)",
      )
      .eq("following_id", id)
      .limit(100),
    supabase
      .from("follows")
      .select(
        "following_id,user:profiles!follows_following_id_fkey(id,username,display_name,full_name,avatar_url)",
      )
      .eq("follower_id", id)
      .limit(100),
    supabase
      .from("projects")
      .select("*,community:communities(id,name,logo_url)")
      .eq("owner_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("community_members")
      .select("community:communities(id,name,logo_url,description)")
      .eq("user_id", id),
    getPosts({ author: id }),
  ]);
  const [
    followersQ,
    followingQ,
    postsQ,
    followerRows,
    followingRows,
    projects,
    memberRows,
    posts,
  ] = results;
  const firstError = [
    followersQ,
    followingQ,
    postsQ,
    followerRows,
    followingRows,
    projects,
    memberRows,
  ].find((r) => r?.error)?.error;
  if (firstError)
    return (page.innerHTML = empty("Profile unavailable", firstError.message));
  const followers = followersQ.count || 0,
    following = followingQ.count || 0,
    postCount = postsQ.count || 0;
  const own = id === state.session.user.id;
  let isFollowing = false;
  if (!own) {
    const { data } = await supabase
      .from("follows")
      .select("follower_id")
      .eq("follower_id", state.session.user.id)
      .eq("following_id", id)
      .maybeSingle();
    isFollowing = !!data;
  }
  page.innerHTML = `<section class="profileHeader"><div class="profileAvatarWrap">${image(p.avatar_url, p.display_name || p.full_name || p.username, "profileAvatar")}</div><div class="profileIdentity"><div class="eyebrow">@${esc(p.username)}</div><h1>${esc(p.display_name || p.full_name || "Developer")}</h1><p>${esc(p.bio || "Building things and solving problems.")}</p>${p.location ? `<div class="profileLocation">⌖ ${esc(p.location)}</div>` : ""}<div class="profileStats"><button onclick="openPeopleList('${id}','followers')"><b>${followers}</b><span>followers</span></button><button onclick="openPeopleList('${id}','following')"><b>${following}</b><span>following</span></button><span><b>${postCount}</b><span>posts</span></span></div></div><div class="profileActions">${own ? `<button class="primary" onclick="openProfileModal()">Edit profile</button>` : `<button class="${isFollowing ? "secondary" : "primary"}" onclick="toggleFollow('${id}',${isFollowing})">${isFollowing ? "Unfollow" : "Follow"}</button><button class="secondary" onclick="messageUser('${id}')">Message</button>`}</div></section><div class="profileGrid"><section><div class="card"><h2>About</h2><p>${esc(p.bio || "No bio yet.")}</p>${p.location ? `<p class="profileLocation">⌖ ${esc(p.location)}</p>` : ""}<h3>Skills</h3><div class="tags">${(p.skills || []).map((s) => `<span class="tag">${esc(s)}</span>`).join("") || "<span class='muted'>No skills listed.</span>"}</div></div><div class="card"><div class="sectionTitle"><h2>Projects</h2>${own ? `<button class="secondary" onclick="openProjectModal()">+ Add project</button>` : ""}</div><div class="projectList">${(projects.data || []).map(projectCard).join("") || `<p class="muted">${own ? "Add your projects here." : "No projects added yet."}</p>`}</div></div><div class="card"><h2>Posts</h2><div class="profilePosts">${(await Promise.all((posts || []).map(postCard))).join("") || empty("No posts yet", "This developer has not posted anything.")}</div></div></section><aside><div class="card"><h3>Following (${following})</h3><div class="peopleList">${
    (followingRows.data || [])
      .slice(0, 12)
      .map((row) => personRow(row.user))
      .join("") || `<p class="muted">Not following anyone yet.</p>`
  }</div>${following > 12 ? `<button class="linkButton" onclick="openPeopleList('${id}','following')">See all following</button>` : ""}</div><div class="card"><h3>Followers (${followers})</h3><div class="peopleList">${
    (followerRows.data || [])
      .slice(0, 12)
      .map((row) => personRow(row.user))
      .join("") || `<p class="muted">No followers yet.</p>`
  }</div>${followers > 12 ? `<button class="linkButton" onclick="openPeopleList('${id}','followers')">See all followers</button>` : ""}</div><div class="card"><h3>Communities & projects</h3><div class="peopleList">${(memberRows.data || []).map((x) => (x.community ? `<button class="memberRow" onclick="location.hash='community?id=${x.community.id}'">${image(x.community.logo_url, x.community.name, "avatar")}<span><b>${esc(x.community.name)}</b><small>Joined community</small></span></button>` : " ")).join("") || `<p class="muted">No community links yet.</p>`}</div></div><div class="card"><h3>Links</h3>${linkLine("GitHub", p.github_url)}${linkLine("LinkedIn", p.linkedin_url)}${linkLine("Portfolio", p.portfolio_url)}${linkLine("Website", p.website_url)}</div></aside></div>`;
}
function personRow(u) {
  return u
    ? `<button class="memberRow" onclick="location.hash='user?id=${u.id}'">${image(u.avatar_url, u.display_name || u.full_name || u.username)}<span><b>${esc(u.display_name || u.full_name || u.username)}</b><small>@${esc(u.username)}</small></span></button>`
    : "";
}
function projectCard(x) {
  return `<div class="projectCard"><div><h3>${esc(x.name)}</h3><p>${esc(x.description || "")}</p><div class="tags">${(x.technologies || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>${x.community ? `<button class="communityLink" onclick="location.hash='community?id=${x.community.id}'">${esc(x.community.name)}</button>` : ""}</div>${x.url ? `<a target="_blank" rel="noreferrer" href="${esc(x.url)}">Open</a>` : ""}</div>`;
}
function linkLine(label, url) {
  return url
    ? `<a class="linkLine" target="_blank" rel="noreferrer" href="${esc(url)}">${esc(label)} ↗</a>`
    : "";
}

async function openPeopleList(userId, type) {
  const col = type === "followers" ? "follower_id" : "following_id",
    match = type === "followers" ? "following_id" : "follower_id";
  const { data } = await supabase
    .from("follows")
    .select(
      `${col},user:profiles!follows_${col}_fkey(id,username,display_name,full_name,avatar_url)`,
    )
    .eq(match, userId)
    .order("created_at", { ascending: false });
  modal(
    `<h2>${type === "followers" ? "Followers" : "Following"}</h2><div class="peopleList">${(data || []).map((x) => personRow(x.user)).join("") || `<p class="muted">No ${type} yet.</p>`}</div>`,
  );
}
window.openPeopleList = openPeopleList;

async function toggleFollow(id, following) {
  const action = following
    ? supabase
        .from("follows")
        .delete()
        .eq("follower_id", state.session.user.id)
        .eq("following_id", id)
    : supabase
        .from("follows")
        .insert({ follower_id: state.session.user.id, following_id: id });
  const { error } = await action;
  if (error) toast(error.message, "error");
  else {
    toast(following ? "Unfollowed." : "Following.", "success");
    navigate(`user?id=${id}`);
  }
}
window.toggleFollow = toggleFollow;

async function messageUser(otherId) {
  if (otherId === state.session.user.id)
    return toast("You cannot message yourself.", "error");
  const { data, error } = await supabase.rpc(
    "get_or_create_direct_conversation",
    { other_user_id: otherId },
  );
  if (error) return toast(error.message, "error");
  location.hash = `messages?conversation=${data}`;
}
window.messageUser = messageUser;

function communityMessageMarkup(m, communityId, channelId) {
  const own = m.sender_id === state.session.user.id,
    deleted = !!m.deleted_at;
  const attachment = m.attachment_url
    ? `<a class="messageAttachment" href="${esc(m.attachment_url)}" target="_blank" rel="noreferrer">📎 ${esc(m.attachment_name || "Attachment")}</a>`
    : "";
  const voice = m.voice_url
    ? `<audio class="voicePlayer" controls src="${esc(m.voice_url)}"></audio>${m.voice_duration_seconds ? `<small class="voiceDuration">${m.voice_duration_seconds}s</small>` : ""}`
    : "";
  const body = deleted
    ? `<span class="messageDeleted">Message unsent</span>`
    : `${m.content ? `<div>${esc(m.content)}</div>` : ""}${attachment}${voice}`;
  return `<div class="workspaceMessage ${own ? "mine" : ""}">
    ${image(m.sender?.avatar_url, m.sender?.display_name || m.sender?.username, "avatar tiny")}
    <div class="workspaceMessageBody">
      <div class="workspaceMessageMeta">
        <b>${esc(m.sender?.display_name || m.sender?.username)}</b>
        <small>${timeAgo(m.created_at)}</small>
        ${own && !deleted ? `<button class="messageMenuBtn" title="Unsend message" onclick="unsendCommunityMessage('${m.id}','${communityId}','${channelId || ""}')">⋯</button>` : ""}
      </div>
      <div class="workspaceBubble ${deleted ? "deleted" : ""}">${body}</div>
    </div>
  </div>`;
}

async function refreshCommunityChat(
  id,
  channelId = state.selectedCommunityChannel,
) {
  let query = supabase
    .from("community_messages")
    .select(
      "*,sender:profiles!community_messages_sender_id_fkey(username,display_name,full_name,avatar_url)",
    )
    .eq("community_id", id)
    .order("created_at", { ascending: true })
    .limit(200);
  if (channelId) query = query.eq("channel_id", channelId);
  const { data, error } = await query;
  if (error) {
    toast(error.message, "error");
    return;
  }
  const chat = document.querySelector("#communityChat");
  if (!chat) return;
  chat.innerHTML =
    (data || [])
      .map((m) => communityMessageMarkup(m, id, channelId))
      .join("") ||
    `<div class="chatEmpty"><div>💬</div><p>No messages in this channel yet.</p><small>Be the first to start the conversation.</small></div>`;
  chat.scrollTop = chat.scrollHeight;
}

window.refreshCommunityChat = refreshCommunityChat;

async function ensureCommunityChannels(id) {
  const { data, error } = await supabase.rpc(
    "ensure_default_community_channels",
    { community_id_input: id },
  );
  if (error) throw error;
  return data || [];
}

async function renderCommunityOverview(page, id) {
  if (!id)
    return (page.innerHTML = empty(
      "Community not found",
      "Choose a community from Explore.",
    ));
  const { data: c, error } = await supabase
    .from("communities")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !c)
    return (page.innerHTML = empty(
      "Community not found",
      "This community is unavailable.",
    ));
  await supabase.rpc("record_community_view", { community_id_input: id });
  if (c?.category) trackInterest("community_category", c.category);
  const [membersQ, membershipQ, applicationQ, eventsQ, filesQ] =
    await Promise.all([
      supabase
        .from("community_members")
        .select(
          "*,user:profiles!community_members_user_id_fkey(id,username,display_name,full_name,avatar_url,bio,skills)",
        )
        .eq("community_id", id)
        .order("joined_at", { ascending: true }),
      supabase
        .from("community_members")
        .select("role")
        .eq("community_id", id)
        .eq("user_id", state.session.user.id)
        .maybeSingle(),
      supabase
        .from("community_applications")
        .select("status")
        .eq("community_id", id)
        .eq("applicant_id", state.session.user.id)
        .maybeSingle(),
      supabase
        .from("community_events")
        .select("*")
        .eq("community_id", id)
        .order("starts_at", { ascending: true })
        .limit(4),
      supabase
        .from("community_files")
        .select(
          "*,uploader:profiles!community_files_uploader_id_fkey(display_name,username,avatar_url)",
        )
        .eq("community_id", id)
        .order("created_at", { ascending: false })
        .limit(6),
    ]);
  const joined = !!membershipQ.data || c.creator_id === state.session.user.id;
  const creator = c.creator_id === state.session.user.id;
  const categories = [
    "Web Development",
    "Mobile Development",
    "AI & Machine Learning",
    "Data Science",
    "Cybersecurity",
    "Cloud & DevOps",
    "Game Development",
    "Blockchain & Web3",
    "Open Source",
    "UI/UX & Design",
    "Startups & Founders",
    "Programming Languages",
    "Career & Jobs",
    "Freelancing",
    "Robotics & IoT",
    "No-Code & Automation",
    "Trading & Finance",
  ];
  page.innerHTML = `<div class="communityOverview"><button class="back" onclick="history.back()">← Back to communities</button><div class="communityOverviewHero" ${c.banner_url ? `style="background-image:linear-gradient(90deg,rgba(4,10,20,.94),rgba(4,10,20,.35)),url('${esc(c.banner_url)}')"` : ""}><div>${image(c.logo_url, c.name, "communityIcon xxl")}</div><div class="communityOverviewIdentity"><span class="categoryPill">${esc(c.category || "Community")}</span><h1>${esc(c.name)}</h1><p>${esc(c.description || "A community for developers and builders.")}</p><div class="overviewStats"><span><b>${Number(c.member_count || 0).toLocaleString()}</b> members</span><span><b>${Number(c.view_count || 0).toLocaleString()}</b> views</span><span>${esc(c.remote_mode || "Remote")}</span><span>${esc(c.location || "Global")}</span></div></div></div><div class="communityOverviewGrid"><main><section class="overviewCard"><h2>About this community</h2><p>${esc(c.description || "No additional description yet.")}</p><div class="overviewTwoCol"><div><h3>What you'll find</h3><div class="tagCloud">${
    (c.required_skills || [])
      .map((s) => `<span class="tag">${esc(s)}</span>`)
      .join("") ||
    categories
      .slice(0, 4)
      .map((x) => `<span class="tag">${x}</span>`)
      .join("")
  }</div></div><div><h3>Community type</h3><p class="muted">Recruitment: ${esc(recruitmentLabel(c))}.</p><p class="muted">${esc(c.rules || "Be respectful, share useful work, and help other builders.")}</p></div></div></section><section class="overviewCard"><div class="sectionTitle"><div><h2>Members</h2><p class="muted">People building inside this community.</p></div><button class="linkButton" onclick="openPeopleListForCommunity('${id}')">View all →</button></div><div class="memberPreviewGrid">${
    (membersQ.data || [])
      .slice(0, 8)
      .map(
        (m) =>
          `<button class="memberPreview" onclick="location.hash='user?id=${m.user?.id}'">${image(m.user?.avatar_url, m.user?.display_name || m.user?.username, "avatar large")}<b>${esc(m.user?.display_name || m.user?.username || "Developer")}</b><small>@${esc(m.user?.username || "")}</small></button>`,
      )
      .join("") || `<p class="muted">No members yet.</p>`
  }</div></section><section class="overviewCard"><h2>Upcoming events</h2>${(eventsQ.data || []).map((e) => `<div class="resourceRow"><div class="resourceIcon">◷</div><div><b>${esc(e.title)}</b><small>${new Date(e.starts_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</small></div></div>`).join("") || `<p class="muted">No events scheduled yet.</p>`}</section></main><aside class="communityJoinRail"><section class="joinCard"><div class="joinCardTop"><span class="statusDot"></span><b>${joined ? "You're a member" : "Public community"}</b></div>${joined ? `<button class="primary full" onclick="location.hash='communityChat?id=${id}'">Open community</button>${!creator ? `<button class="secondary full" onclick="leaveCommunity('${id}')">Leave community</button>` : ""}` : applicationQ.data?.status === "pending" ? `<button class="secondary full" disabled>Application pending</button>` : (c.recruitment_mode || (!c.recruitment_enabled ? "closed" : "application")) === "open" ? `<button class="primary full" onclick="joinCommunity('${id}')">Join community</button>` : (c.recruitment_mode || (!c.recruitment_enabled ? "closed" : "application")) === "application" ? `<button class="primary full" onclick="applyCommunity('${id}')">Apply to join</button>` : `<button class="secondary full" disabled>Recruitment closed</button>`}<div class="joinMeta"><span>✓ ${Number(c.member_count || 0).toLocaleString()} members</span><span>✓ ${esc(c.remote_mode || "Remote")}</span><span>✓ ${esc(c.category || "Developer community")}</span></div></section><section class="overviewCard compact"><h3>Community details</h3><div class="settingLine">◉ Public</div><div class="settingLine">♧ ${esc(recruitmentLabel(c))}</div><div class="settingLine">⌖ ${esc(c.location || "Global")}</div><div class="settingLine">★ ${esc(c.category || "Community")}</div></section><section class="overviewCard compact"><h3>Recent resources</h3>${(filesQ.data || []).map((f) => `<a class="resourceRow" href="${esc(f.url)}" target="_blank" rel="noreferrer"><div class="resourceIcon">▣</div><div><b>${esc(f.name)}</b><small>${timeAgo(f.created_at)}</small></div></a>`).join("") || `<p class="muted">No resources yet.</p>`}</section></aside></div></div>`;
}

async function renderCommunityWorkspace(page, id) {
  const [membership, basic, communityQ] = await Promise.all([
    supabase
      .from("community_members")
      .select("role")
      .eq("community_id", id)
      .eq("user_id", state.session.user.id)
      .maybeSingle(),
    supabase.from("communities").select("creator_id").eq("id", id).single(),
    supabase.from("communities").select("*").eq("id", id).single(),
  ]);
  if (!membership.data && basic.data?.creator_id !== state.session.user.id)
    return renderCommunityOverview(page, id);
  const { data: c, error } = communityQ;
  if (error || !c)
    return (page.innerHTML = empty(
      "Community not found",
      "This community is unavailable.",
    ));
  if (c?.category) trackInterest("community_category", c.category);
  const [viewResult, creatorRepair, channels] = await Promise.all([
    supabase.rpc("record_community_view", { community_id_input: id }),
    c.creator_id === state.session.user.id
      ? supabase.rpc("ensure_community_creator_membership", {
          community_id_input: id,
        })
      : Promise.resolve({}),
    ensureCommunityChannels(id),
  ]);
  const [membersQ, membershipQ, applicationQ, eventsQ, filesQ] =
    await Promise.all([
      supabase
        .from("community_members")
        .select(
          "*,user:profiles!community_members_user_id_fkey(id,username,display_name,full_name,avatar_url)",
        )
        .eq("community_id", id)
        .order("joined_at", { ascending: true }),
      supabase
        .from("community_members")
        .select("role")
        .eq("community_id", id)
        .eq("user_id", state.session.user.id)
        .maybeSingle(),
      supabase
        .from("community_applications")
        .select("status")
        .eq("community_id", id)
        .eq("applicant_id", state.session.user.id)
        .maybeSingle(),
      supabase
        .from("community_events")
        .select("*")
        .eq("community_id", id)
        .order("starts_at", { ascending: true })
        .limit(5),
      supabase
        .from("community_files")
        .select(
          "*,uploader:profiles!community_files_uploader_id_fkey(display_name,username,avatar_url)",
        )
        .eq("community_id", id)
        .order("created_at", { ascending: false })
        .limit(5),
    ]);
  const queryError = [
    membersQ,
    membershipQ,
    applicationQ,
    eventsQ,
    filesQ,
  ].find((x) => x.error)?.error;
  if (queryError)
    return (page.innerHTML = empty(
      "Community unavailable",
      queryError.message,
    ));
  const joined = !!membershipQ.data || c.creator_id === state.session.user.id;
  const creator = c.creator_id === state.session.user.id;
  state.selectedCommunityChannel =
    state.selectedCommunityChannel &&
    channels.some((x) => x.id === state.selectedCommunityChannel)
      ? state.selectedCommunityChannel
      : (channels.find((x) => x.slug === "general") || channels[0])?.id || null;
  const activeChannel =
    channels.find((x) => x.id === state.selectedCommunityChannel) ||
    channels[0];
  let messagesQ = supabase
    .from("community_messages")
    .select(
      "*,sender:profiles!community_messages_sender_id_fkey(username,display_name,full_name,avatar_url)",
    )
    .eq("community_id", id)
    .order("created_at", { ascending: true })
    .limit(100);
  if (activeChannel?.id)
    messagesQ = messagesQ.eq("channel_id", activeChannel.id);
  const { data: messages, error: messagesError } = await messagesQ;
  if (messagesError)
    return (page.innerHTML = empty(
      "Community chat unavailable",
      messagesError.message,
    ));
  let directConvs = [];
  const cmQ = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", state.session.user.id)
    .limit(8);
  if (!cmQ.error && cmQ.data?.length) {
    const ids = cmQ.data.map((x) => x.conversation_id);
    const cv = await supabase
      .from("conversations")
      .select("*")
      .in("id", ids)
      .order("updated_at", { ascending: false })
      .limit(5);
    directConvs = cv.data || [];
  }
  const creatorMember = (membersQ.data || []).find((m) => m.role === "creator");
  page.innerHTML = `<div class="communityWorkspace">
    <div class="workspaceHeader">
      <button class="back workspaceBack" onclick="history.back()">← Back</button>
      <div class="workspaceHero" ${c.banner_url ? `style="background-image:linear-gradient(90deg,rgba(8,17,31,.72),rgba(8,17,31,.12)),url('${esc(c.banner_url)}')"` : ""}>
        ${image(c.logo_url, c.name, "workspaceCommunityLogo")}
        <div class="workspaceHeroText"><div class="eyebrow">${esc(c.category || "COMMUNITY")}</div><h1>${esc(c.name)} <span class="publicBadge">Public</span></h1><p>${esc(c.description || "Build together.")}</p><small>${c.member_count || 0} members · ${c.view_count || 0} views · Created ${timeAgo(c.created_at)} · ${esc(c.remote_mode || "Remote")}</small></div>
        <div class="workspaceHeroActions">${creator ? `<button class="secondary" onclick="openCommunityModal('${id}')">Edit</button>` : joined ? `<button class="secondary" onclick="leaveCommunity('${id}')">Leave</button>` : applicationQ.data?.status === "pending" ? `<button class="secondary" disabled>Application pending</button>` : (c.recruitment_mode || (!c.recruitment_enabled ? "closed" : "application")) === "open" ? `<button class="primary" onclick="joinCommunity('${id}')">Join community</button>` : (c.recruitment_mode || (!c.recruitment_enabled ? "closed" : "application")) === "application" ? `<button class="primary" onclick="applyCommunity('${id}')">Apply to join</button>` : `<button class="secondary" disabled>Recruitment closed</button>`}</div>
      </div>
      <div class="workspaceTabs"><button class="workspaceTab active" data-tab="chat">▣ Chat</button></div>
    </div>
    <div class="workspaceBody">
      <aside class="workspaceLeft">
        <div class="workspaceSideTitle">Channels ${creator ? `<button class="channelAddBtn" title="Create channel" onclick="openCreateChannelModal('${id}')">＋</button>` : ""}</div>
        <div class="channelList">${channels.map((ch) => `<div class="channelItemWrap"><button class="channelItem ${ch.id === activeChannel?.id ? "active" : ""}" data-channel-id="${ch.id}" data-channel-name="${esc(ch.name)}" data-channel-topic="${esc(ch.topic || "")}" onclick="selectCommunityChannel('${id}','${ch.id}')"><span>#</span><span class="channelItemName">${esc(ch.name)}</span>${ch.messaging_locked ? `<span class="channelLock" title="Messaging locked">🔒</span>` : ""}</button>${creator ? `<button class="channelDeleteBtn" title="Delete #${esc(ch.name)}" aria-label="Delete channel" onclick="deleteCommunityChannel(event,'${id}','${ch.id}')">×</button>` : ""}</div>`).join("")}</div>
        <div class="workspaceSideTitle dmTitle">Direct Messages <button onclick="location.hash='messages'">＋</button></div>
        <div class="communityDMList">${directConvs.length ? await communityDMRows(directConvs) : `<div class="sideMuted">No direct messages yet.</div>`}</div>
        <div class="workspaceUserCard">${image(state.profile?.avatar_url, state.profile?.display_name || state.profile?.username, "avatar")}<div><b>${esc(state.profile?.display_name || state.profile?.username || "Developer")}</b><small>@${esc(state.profile?.username || "")}</small></div><button onclick="location.hash='profile'">View Profile</button></div>
      </aside>
      <main class="workspaceCenter">
        <div class="channelHeader"><div><div class="channelTitleLine"><h2 id="activeChannelName"># ${esc(activeChannel?.name || "general")}</h2>${activeChannel?.messaging_locked ? `<span class="channelLockedBadge">🔒 Messaging locked</span>` : ""}</div><small id="activeChannelTopic">${esc(activeChannel?.topic || "General discussion about ideas, startups and tech")}</small></div><div class="channelHeaderActions">${creator && activeChannel ? `<button class="channelLockToggle ${activeChannel.messaging_locked ? "isLocked" : ""}" title="${activeChannel.messaging_locked ? "Allow members to send messages" : "Stop members from sending messages"}" onclick="toggleCommunityChannelLock('${id}','${activeChannel.id}',${activeChannel.messaging_locked})">${activeChannel.messaging_locked ? "🔓 Unlock" : "🔒 Lock"}</button>` : ""}<button class="iconBtn" title="Chat settings" onclick="openCommunityChatSettings('${id}','${activeChannel?.id || ""}')">⚙</button></div></div>
        <div class="workspaceChat" id="communityChat">${(messages || []).map((m) => communityMessageMarkup(m, id, activeChannel?.id)).join("") || `<div class="chatEmpty"><div>💬</div><p>No messages in this channel yet.</p><small>Be the first to start the conversation.</small></div>`}</div>
        ${joined ? (activeChannel?.messaging_locked && !creator ? `<div class="channelLockedNotice">🔒 <div><b>Messaging is paused</b><small>The community head has temporarily disabled messages in this channel.</small></div></div>` : `<form id="communityChatForm" class="workspaceComposer"><input type="file" id="communityMessageFile" class="hidden" accept="image/*,.pdf,.txt,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx"><button type="button" class="composerIcon" title="Attach file" onclick="document.querySelector('#communityMessageFile').click()">＋</button><button type="button" class="composerIcon" id="communityVoiceBtn" title="Record voice note" onclick="toggleCommunityVoiceRecording('${id}','${activeChannel?.id || ""}')">🎙</button><div class="composerField"><div id="communityAttachmentPreview" class="attachmentPreview hidden"></div><div id="communityVoiceStatus" class="voiceRecordingStatus hidden"></div><input name="message" autocomplete="off" placeholder="Message #${esc(activeChannel?.name || "general")}…"></div><button class="sendButton" aria-label="Send">➤</button></form>`) : `<div class="joinChatNotice">Join the community to participate in chat.</div>`}
      </main>
      <aside class="workspaceRight">
        <section class="rightCard"><div class="rightTitle"><h3>Members (${membersQ.data?.length || 0})</h3><button class="linkButton" onclick="openPeopleListForCommunity('${id}')">View all</button></div><div class="memberRoster">${(
          membersQ.data || []
        )
          .slice(0, 8)
          .map(
            (m) =>
              `<button class="rosterRow" onclick="location.hash='user?id=${m.user?.id}'">${image(m.user?.avatar_url, m.user?.display_name || m.user?.username, "avatar small")}<span><b>${esc(m.user?.display_name || m.user?.username || "Developer")}</b><small>${esc(m.role || "member")} · ${m.user?.id === state.session.user.id ? "Online" : "Member"}</small></span>${m.role === "creator" ? `<em>♛</em>` : ""}</button>`,
          )
          .join("")}</div></section>
        <section class="rightCard"><h3>Community Settings</h3><div class="settingLine"><span>◉</span> Public Community</div><div class="settingLine"><span>♧</span> ${c.recruitment_enabled ? "Recruitment Enabled" : "Recruitment Closed"}</div><div class="settingLine"><span>◷</span> ${c.member_count || 0} Members</div><div class="settingLine"><span>⌖</span> ${esc(c.location || c.remote_mode || "Remote")}</div></section>
        <section class="rightCard"><div class="rightTitle"><h3>Upcoming Events</h3>${creator ? `<button class="linkButton" onclick="openCommunityEventModal('${id}')">+ Add</button>` : ""}</div>${(eventsQ.data || []).map((e) => `<div class="resourceRow"><div class="resourceIcon">◷</div><div><b>${esc(e.title)}</b><small>${new Date(e.starts_at).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</small></div></div>`).join("") || `<div class="sideMuted">No events scheduled.</div>`}</section>
        <section class="rightCard"><div class="rightTitle"><h3>Recent Files</h3>${joined ? `<button class="linkButton" onclick="openCommunityFileModal('${id}')">+ Add</button>` : ""}</div>${(filesQ.data || []).map((f) => `<a class="resourceRow" href="${esc(f.url)}" target="_blank" rel="noreferrer"><div class="resourceIcon">▣</div><div><b>${esc(f.name)}</b><small>${esc(f.uploader?.display_name || f.uploader?.username || "Member")} · ${timeAgo(f.created_at)}</small></div></a>`).join("") || `<div class="sideMuted">No shared files yet.</div>`}</section>
        ${creator ? `<section class="rightCard" id="communityApplications"><h3>Recruitment applications</h3><p class="sideMuted">Loading pending applications…</p></section>` : ""}
      </aside>
    </div>
  </div>`;
  document
    .querySelector("#communityChat")
    ?.scrollTo({ top: 999999, behavior: "instant" });
  document
    .querySelector("#communityChatForm")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = e.target.message,
        fileInput = document.querySelector("#communityMessageFile"),
        button = e.target.querySelector(".sendButton");
      const text = input.value.trim(),
        file = fileInput?.files?.[0];
      if (!text && !file) return;
      button.disabled = true;
      try {
        let attachmentUrl = null,
          attachmentName = null,
          attachmentType = null;
        if (file) {
          const up = await uploadMessageFile(file, "community", id);
          attachmentUrl = up.url;
          attachmentName = up.name;
          attachmentType = up.type;
        }
        const { error } = await supabase.rpc("send_community_message", {
          community_id_input: id,
          channel_id_input: activeChannel?.id || null,
          content_input: text,
          attachment_url_input: attachmentUrl,
          attachment_name_input: attachmentName,
          attachment_type_input: attachmentType,
          voice_url_input: null,
          voice_duration_input: null,
        });
        if (error) throw error;
        input.value = "";
        if (fileInput) fileInput.value = "";
        clearCommunityAttachmentPreview();
        await refreshCommunityChat(id, activeChannel?.id);
      } catch (err) {
        toast(err.message || "Could not send message.", "error");
      } finally {
        button.disabled = false;
      }
    });
  const communityFileInput = document.querySelector("#communityMessageFile");
  communityFileInput?.addEventListener("change", () => {
    const file = communityFileInput.files?.[0];
    const preview = document.querySelector("#communityAttachmentPreview");
    if (!preview) return;
    if (!file) {
      clearCommunityAttachmentPreview();
      return;
    }
    preview.classList.remove("hidden");
    preview.innerHTML = `<span>📎 ${esc(file.name)}</span><small>${Math.max(1, Math.ceil(file.size / 1024))} KB</small><button type="button" aria-label="Remove attachment" onclick="clearCommunityAttachmentPreview()">×</button>`;
  });
  if (creator) await loadCommunityApplications(id);
}

async function communityDMRows(convs) {
  const rows = [];
  for (const c of convs) {
    const { data: u } = await supabase
      .from("conversation_members")
      .select(
        "user:profiles!conversation_members_user_id_fkey(id,display_name,full_name,username,avatar_url)",
      )
      .eq("conversation_id", c.id)
      .neq("user_id", state.session.user.id)
      .limit(1)
      .maybeSingle();
    const user = u?.user;
    if (user)
      rows.push(
        `<button class="dmRow" onclick="location.hash='messages?conversation=${c.id}'">${image(user.avatar_url, user.display_name || user.username, "avatar small")}<span><b>${esc(user.display_name || user.username)}</b><small>Direct message</small></span></button>`,
      );
  }
  return (
    rows.join("") || `<div class="sideMuted">No direct messages yet.</div>`
  );
}
window.selectCommunityChannel = async function (id, channelId) {
  state.selectedCommunityChannel = channelId;
  await renderCommunityWorkspace(document.querySelector("#page"), id);
};

async function isCommunityCreator(id) {
  const { data } = await supabase
    .from("communities")
    .select("creator_id")
    .eq("id", id)
    .single();
  return data?.creator_id === state.session.user.id;
}
window.openCommunityPostModal = async function (communityId) {
  modal(
    `<h2>New community post</h2><form id="communityPostForm"><label>Title<input name="title" required maxlength="180"></label><label>Content<textarea name="content" required rows="7"></textarea></label><button class="primary full">Publish</button></form>`,
  );
  document.querySelector("#communityPostForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const { error } = await supabase
      .from("community_posts")
      .insert({
        community_id: communityId,
        author_id: state.session.user.id,
        title: String(f.get("title")),
        content: String(f.get("content")),
      });
    if (error) toast(error.message, "error");
    else {
      closeModal();
      toast("Community post published.", "success");
      await switchCommunityTab(communityId, "posts");
    }
  };
};

window.openPeopleListForCommunity = async function (id) {
  const { data } = await supabase
    .from("community_members")
    .select(
      "user:profiles!community_members_user_id_fkey(id,username,display_name,full_name,avatar_url)",
    )
    .eq("community_id", id)
    .order("joined_at", { ascending: true });
  modal(
    `<h2>Community members</h2><div class="peopleList">${(data || []).map((x) => personRow(x.user)).join("") || `<p class="muted">No members yet.</p>`}</div>`,
  );
};

window.leaveCommunity = async (id) => {
  const { error } = await supabase
    .from("community_members")
    .delete()
    .eq("community_id", id)
    .eq("user_id", state.session.user.id);
  if (error) toast(error.message, "error");
  else navigate(`community?id=${id}`);
};

async function loadCommunityApplications(communityId) {
  const root = document.querySelector("#communityApplications");
  if (!root) return;
  const { data, error } = await supabase.rpc(
    "get_pending_community_applications",
    { community_id_input: communityId },
  );
  if (error) {
    root.innerHTML = `<h2>Recruitment applications</h2><p class="muted">${esc(error.message)}</p>`;
    return;
  }
  root.innerHTML = `<div class="rightTitle"><h2>Recruitment applications</h2><span class="pendingCount">${data?.length || 0} pending</span></div><p class="sideMuted">Only applications awaiting a decision are shown here.</p>${(data || []).map((a) => `<div class="communityApplication">${personRow({ id: a.applicant_id, username: a.username, display_name: a.display_name, full_name: a.full_name, avatar_url: a.avatar_url, location: a.location })}<small class="muted">Pending · ${timeAgo(a.created_at)}</small><div class="appActions"><button class="primary" onclick="reviewCommunityApplication('${a.id}','${communityId}','accepted')">Accept</button><button class="danger" onclick="reviewCommunityApplication('${a.id}','${communityId}','rejected')">Deny</button></div></div>`).join("") || `<p class="muted">No pending applications right now.</p>`}`;
}
window.reviewCommunityApplication = async function (
  applicationId,
  communityId,
  status,
) {
  const { error } = await supabase.rpc("review_community_application", {
    application_id_input: applicationId,
    status_input: status,
  });
  if (error) return toast(error.message, "error");
  toast(
    status === "accepted"
      ? "Applicant accepted and added to the community."
      : "Application denied.",
    "success",
  );
  await loadCommunityApplications(communityId);
};

async function renderMessages(page) {
  const { data: members } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", state.session.user.id);
  const ids = (members || []).map((x) => x.conversation_id);
  let convs = [];
  if (ids.length) {
    const { data } = await supabase
      .from("conversations")
      .select("*")
      .in("id", ids)
      .order("updated_at", { ascending: false });
    convs = data || [];
  }
  page.innerHTML = `<div class="pageHead"><div><div class="eyebrow">MESSAGES</div><h1>Direct messages</h1><p>Private conversations with developers.</p></div></div><div class="messagesLayout"><aside class="conversationList">${await conversationList(convs)}</aside><section class="chatPanel" id="chatPanel">${state.selectedConversation ? "Loading…" : empty("No conversation selected", "Open a developer profile and choose Message.")}</section></div>`;
  if (state.selectedConversation) await loadChat(state.selectedConversation);
}
async function conversationList(convs) {
  if (!convs.length)
    return empty(
      "No messages",
      "Start a conversation from a developer profile.",
    );
  const html = [];
  for (const c of convs) {
    const { data: other } = await supabase
      .from("conversation_members")
      .select(
        "user:profiles!conversation_members_user_id_fkey(id,username,display_name,full_name,avatar_url)",
      )
      .eq("conversation_id", c.id)
      .neq("user_id", state.session.user.id)
      .limit(1)
      .maybeSingle();
    const { data: last } = await supabase
      .from("messages")
      .select("content,created_at")
      .eq("conversation_id", c.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const u = other?.user;
    html.push(
      `<button class="conversationRow ${state.selectedConversation === c.id ? "active" : ""}" onclick="location.hash='messages?conversation=${c.id}'">${image(u?.avatar_url, u?.display_name || u?.full_name || u?.username)}<span><b>${esc(u?.display_name || u?.username || "Developer")}</b><small>${esc(last?.content || "No messages yet")}</small></span><time>${last ? timeAgo(last.created_at) : ""}</time></button>`,
    );
  }
  return html.join("");
}
async function fetchDirectMessages(id) {
  const { data, error } = await supabase
    .from("messages")
    .select(
      "*,sender:profiles!messages_sender_id_fkey(display_name,username,avatar_url)",
    )
    .eq("conversation_id", id)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}
function directMessageMarkup(messages, id) {
  return (
    (messages || [])
      .map((m) => {
        const own = m.sender_id === state.session.user.id,
          deleted = !!m.deleted_at;
        const attachment = m.attachment_url
          ? `<a class="messageAttachment" href="${esc(m.attachment_url)}" target="_blank" rel="noreferrer">📎 ${esc(m.attachment_name || "Attachment")}</a>`
          : "";
        const voice = m.voice_url
          ? `<audio class="voicePlayer" controls src="${esc(m.voice_url)}"></audio>`
          : "";
        const body = deleted
          ? `<span class="messageDeleted">Message unsent</span>`
          : `${m.content ? `<div>${esc(m.content)}</div>` : ""}${attachment}${voice}`;
        return `<div class="igMessage ${own ? "mine" : ""}"><div class="bubble ${deleted ? "deleted" : ""}">${body}${own && !deleted ? `<button class="messageMenuBtn" title="Unsend message" onclick="unsendDirectMessage('${m.id}','${id}')">Unsend</button>` : ""}<small>${timeAgo(m.created_at)}</small></div></div>`;
      })
      .join("") ||
    `<div class="chatEmpty"><div>💬</div><p>No messages yet.</p><small>Start the conversation.</small></div>`
  );
}
async function refreshDirectMessages(id, keepBottom = true) {
  const box = document.querySelector("#chatMessages");
  if (!box) return loadChat(id);
  try {
    const messages = await fetchDirectMessages(id);
    box.innerHTML = directMessageMarkup(messages, id);
    if (keepBottom) box.scrollTop = box.scrollHeight;
  } catch (err) {
    toast(err.message || "Could not refresh messages.", "error");
  }
}
async function loadChat(id) {
  const panel = document.querySelector("#chatPanel");
  if (!panel) return;
  try {
    const { data: members } = await supabase
      .from("conversation_members")
      .select("user_id")
      .eq("conversation_id", id);
    const otherId = (members || [])
      .map((x) => x.user_id)
      .find((x) => x !== state.session.user.id);
    const other = otherId ? await profile(otherId) : null;
    const messages = await fetchDirectMessages(id);
    const currentInput =
      document.querySelector("#chatForm input[name=message]")?.value ||
      state.messageDrafts[id] ||
      "";
    panel.innerHTML = `<div class="chatHeader">${image(other?.avatar_url, other?.display_name || other?.username)}<div><b>${esc(other?.display_name || other?.username || "Developer")}</b><small>@${esc(other?.username || "")}</small></div><button class="iconBtn chatSettingsBtn" title="Chat settings" onclick="openDirectChatSettings('${id}')">⚙</button></div><div class="chatMessages" id="chatMessages">${directMessageMarkup(messages, id)}</div><form id="chatForm" class="chatComposer"><input type="file" id="directMessageFile" class="hidden" accept="image/*,.pdf,.txt,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx"><button type="button" class="composerIcon" title="Attach file" onclick="document.querySelector('#directMessageFile').click()">＋</button><button type="button" class="composerIcon" id="directVoiceBtn" title="Record voice note" onclick="toggleDirectVoiceRecording('${id}')">🎙</button><input name="message" autocomplete="off" placeholder="Message…" value="${esc(currentInput)}"><button class="primary">Send</button></form>`;
    const cm = document.querySelector("#chatMessages");
    cm.scrollTop = cm.scrollHeight;
    const form = document.querySelector("#chatForm"),
      input = form.querySelector("input[name=message]"),
      fileInput = document.querySelector("#directMessageFile");
    input.oninput = () => (state.messageDrafts[id] = input.value);
    form.onsubmit = async (e) => {
      e.preventDefault();
      const text = input.value.trim(),
        file = fileInput?.files?.[0];
      if (!text && !file) return;
      const send = e.target.querySelector("button.primary");
      send.disabled = true;
      try {
        let attachmentUrl = null,
          attachmentName = null,
          attachmentType = null;
        if (file) {
          const up = await uploadMessageFile(file, "direct", id);
          attachmentUrl = up.url;
          attachmentName = up.name;
          attachmentType = up.type;
        }
        const { error } = await supabase.rpc("send_direct_message", {
          conversation_id_input: id,
          content_input: text,
          attachment_url_input: attachmentUrl,
          attachment_name_input: attachmentName,
          attachment_type_input: attachmentType,
          voice_url_input: null,
        });
        if (error) throw error;
        input.value = "";
        state.messageDrafts[id] = "";
        if (fileInput) fileInput.value = "";
        await refreshDirectMessages(id, true);
      } catch (err) {
        toast(err.message || "Could not send message.", "error");
      } finally {
        send.disabled = false;
        input.focus();
      }
    };
    await supabase
      .from("conversation_members")
      .update({ last_read_at: new Date().toISOString() })
      .eq("conversation_id", id)
      .eq("user_id", state.session.user.id);
  } catch (err) {
    panel.innerHTML = empty(
      "Could not open conversation",
      err.message || "Please try again.",
    );
  }
}

function clearCommunityAttachmentPreview() {
  const input = document.querySelector("#communityMessageFile");
  const preview = document.querySelector("#communityAttachmentPreview");
  if (input) input.value = "";
  if (preview) {
    preview.classList.add("hidden");
    preview.innerHTML = "";
  }
}
window.clearCommunityAttachmentPreview = clearCommunityAttachmentPreview;

async function uploadMessageFile(file, scope, entityId) {
  const max = 20 * 1024 * 1024;
  if (!file || file.size > max)
    throw new Error("File must be 20 MB or smaller.");
  const safe = (file.name || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${state.session.user.id}/${scope}/${entityId}/${crypto.randomUUID()}-${safe}`;
  const { error } = await supabase.storage
    .from("message-media")
    .upload(path, file, {
      upsert: false,
      contentType: file.type || "application/octet-stream",
      cacheControl: "3600",
    });
  if (error) throw error;
  return {
    url: supabase.storage.from("message-media").getPublicUrl(path).data
      .publicUrl,
    name: file.name || safe,
    type: file.type || "application/octet-stream",
  };
}
async function recordAndSendVoice({ scope, entityId, channelId = null }) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder)
    throw new Error("Voice recording is not supported in this browser.");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
    ? "audio/webm;codecs=opus"
    : "audio/webm";
  const recorder = new MediaRecorder(stream, { mimeType: mime });
  const chunks = [];
  return await new Promise((resolve, reject) => {
    const started = Date.now();
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    recorder.onerror = (e) => {
      stream.getTracks().forEach((t) => t.stop());
      reject(e.error || new Error("Recording failed."));
    };
    recorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      try {
        const blob = new Blob(chunks, { type: mime });
        const file = new File([blob], `voice-${Date.now()}.webm`, {
          type: mime,
        });
        const up = await uploadMessageFile(file, scope, entityId);
        const voiceUrl = up.url;
        const duration = Math.max(1, Math.round((Date.now() - started) / 1000));
        let r;
        if (scope === "community")
          r = await supabase.rpc("send_community_message", {
            community_id_input: entityId,
            channel_id_input: channelId,
            content_input: "",
            attachment_url_input: null,
            attachment_name_input: null,
            attachment_type_input: null,
            voice_url_input: voiceUrl,
            voice_duration_input: duration,
          });
        else
          r = await supabase.rpc("send_direct_message", {
            conversation_id_input: entityId,
            content_input: "",
            attachment_url_input: null,
            attachment_name_input: null,
            attachment_type_input: null,
            voice_url_input: voiceUrl,
            voice_duration_input: duration,
          });
        if (r.error) throw r.error;
        resolve(duration);
      } catch (err) {
        reject(err);
      }
    };
    recorder.start();
    setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, 60000);
    window.__activeRecorder = recorder;
  });
}
window.toggleCommunityVoiceRecording = async function (id, channelId) {
  const btn = document.querySelector("#communityVoiceBtn"),
    status = document.querySelector("#communityVoiceStatus");
  if (window.__activeRecorder?.state === "recording") {
    window.__activeRecorder.stop();
    return;
  }
  try {
    if (btn) {
      btn.textContent = "⏹";
      btn.classList.add("recording");
    }
    if (status) {
      status.classList.remove("hidden");
      status.innerHTML = `<span class="recordingDot"></span> Recording voice message <b id="communityRecordingTimer">0:00</b> · click 🎙 again to stop`;
    }
    const timerEl = () => document.querySelector("#communityRecordingTimer");
    const started = Date.now();
    window.__recordingTimer = setInterval(() => {
      const el = timerEl();
      if (el) {
        const s = Math.floor((Date.now() - started) / 1000);
        el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
      }
    }, 250);
    await recordAndSendVoice({ scope: "community", entityId: id, channelId });
    await refreshCommunityChat(id, channelId);
  } catch (err) {
    toast(err.message || "Could not record voice note.", "error");
  } finally {
    clearInterval(window.__recordingTimer);
    window.__recordingTimer = null;
    if (btn) {
      btn.textContent = "🎙";
      btn.classList.remove("recording");
    }
    if (status) {
      status.classList.add("hidden");
      status.innerHTML = "";
    }
    window.__activeRecorder = null;
  }
};
window.toggleDirectVoiceRecording = async function (id) {
  const btn = document.querySelector("#directVoiceBtn");
  if (window.__activeRecorder?.state === "recording") {
    window.__activeRecorder.stop();
    return;
  }
  try {
    if (btn) {
      btn.textContent = "⏹";
      btn.classList.add("recording");
    }
    await recordAndSendVoice({ scope: "direct", entityId: id });
    await loadChat(id);
  } catch (err) {
    toast(err.message || "Could not record voice note.", "error");
  } finally {
    if (btn) {
      btn.textContent = "🎙";
      btn.classList.remove("recording");
    }
    window.__activeRecorder = null;
  }
};
window.toggleCommunityChannelLock = async function (
  communityId,
  channelId,
  currentLocked,
) {
  const { error } = await supabase.rpc("set_community_channel_lock", {
    community_id_input: communityId,
    channel_id_input: channelId,
    locked_input: !currentLocked,
  });
  if (error)
    return toast(
      error.message || "Could not update channel messaging.",
      "error",
    );
  toast(
    !currentLocked
      ? "Members can no longer send messages in this channel."
      : "Members can send messages again.",
    "success",
  );
  state.selectedCommunityChannel = channelId;
  await renderCommunityWorkspace(document.querySelector("#page"), communityId);
};

window.unsendCommunityMessage = async function (
  messageId,
  communityId,
  channelId,
) {
  const { error } = await supabase.rpc("unsend_community_message", {
    message_id_input: messageId,
  });
  if (error) toast(error.message, "error");
  else
    await refreshCommunityChat(
      communityId,
      channelId || state.selectedCommunityChannel,
    );
};
window.unsendDirectMessage = async function (messageId, conversationId) {
  const { error } = await supabase.rpc("unsend_direct_message", {
    message_id_input: messageId,
  });
  if (error) toast(error.message, "error");
  else await loadChat(conversationId);
};
window.openCommunityChatSettings = function (communityId, channelId) {
  modal(
    `<h2>Chat settings</h2><p class="muted">Delete this channel's chat history from your view.</p><button class="danger full" onclick="clearCommunityChatHistory('${communityId}','${channelId}')">Delete chat history</button>`,
  );
};
window.clearCommunityChatHistory = async function (communityId, channelId) {
  const { error } = await supabase.rpc("clear_community_chat_history", {
    community_id_input: communityId,
    channel_id_input: channelId,
  });
  if (error) return toast(error.message, "error");
  closeModal();
  toast("Chat history cleared for you.", "success");
  await refreshCommunityChat(communityId, channelId);
};
window.openDirectChatSettings = function (conversationId) {
  modal(
    `<h2>Chat settings</h2><p class="muted">This clears the conversation from your view only.</p><button class="danger full" onclick="clearDirectChatHistory('${conversationId}')">Delete chat history</button>`,
  );
};
window.clearDirectChatHistory = async function (conversationId) {
  const { error } = await supabase.rpc("clear_direct_chat_history", {
    conversation_id_input: conversationId,
  });
  if (error) return toast(error.message, "error");
  closeModal();
  toast("Chat history cleared for you.", "success");
  await loadChat(conversationId);
};
window.openCreateChannelModal = function (communityId) {
  modal(
    `<h2>Create channel</h2><form id="channelCreateForm"><label>Channel name<input name="name" required maxlength="50" placeholder="design-review"></label><label>Topic<input name="topic" maxlength="120" placeholder="What is this channel for?"></label><button class="primary full">Create channel</button></form>`,
  );
  document.querySelector("#channelCreateForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target),
      b = e.target.querySelector("button");
    b.disabled = true;
    try {
      const { error } = await supabase.rpc("create_community_channel", {
        community_id_input: communityId,
        name_input: String(f.get("name")),
        topic_input: String(f.get("topic") || ""),
      });
      if (error) throw error;
      closeModal();
      toast("Channel created.", "success");
      await renderCommunityWorkspace(
        document.querySelector("#page"),
        communityId,
      );
    } catch (err) {
      toast(err.message || "Could not create channel.", "error");
    } finally {
      b.disabled = false;
    }
  };
};
window.deleteCommunityChannel = async function (event, communityId, channelId) {
  event?.preventDefault();
  event?.stopPropagation();
  const wrap = event?.currentTarget?.closest(".channelItemWrap");
  const channelName =
    wrap?.querySelector(".channelItemName")?.textContent?.trim() ||
    "this channel";
  if (
    !confirm(
      `Delete #${channelName}?\n\nThis removes the channel and its chat history for everyone. This cannot be undone.`,
    )
  )
    return;
  const button = event?.currentTarget;
  if (button) button.disabled = true;
  try {
    const { error } = await supabase.rpc("delete_community_channel", {
      community_id_input: communityId,
      channel_id_input: channelId,
    });
    if (error) throw error;
    if (state.selectedCommunityChannel === channelId)
      state.selectedCommunityChannel = null;
    if (wrap) wrap.remove();
    toast(`#${channelName} deleted.`, "success");
    await renderCommunityWorkspace(
      document.querySelector("#page"),
      communityId,
    );
  } catch (err) {
    toast(err.message || "Could not delete channel.", "error");
    if (button) button.disabled = false;
  }
};

async function renderNotifications(page) {
  await loadNotifications();
  page.innerHTML = `<div class="pageHead"><div><div class="eyebrow">NOTIFICATIONS</div><h1>Activity</h1><p>Likes, comments, follows, messages and community activity.</p></div><button class="secondary" id="readAll">Mark all read</button></div><div class="notificationList">${state.notifications.length ? state.notifications.map((n) => `<button class="notification ${n.is_read ? "" : "unread"}" onclick="markNotification('${n.id}')">${image(n.actor?.avatar_url, n.actor?.display_name || n.actor?.username)}<span><p>${esc(n.message)}</p><small>${timeAgo(n.created_at)}</small></span></button>`).join("") : empty("You're all caught up", "New activity will appear here.")}</div>`;
  document.querySelector("#readAll").onclick = async () => {
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("recipient_id", state.session.user.id);
    await loadNotifications();
    renderShell();
    navigate("notifications");
  };
}
async function loadNotifications() {
  const { data } = await supabase
    .from("notifications")
    .select(
      "*,actor:profiles!notifications_actor_id_fkey(id,username,display_name,full_name,avatar_url)",
    )
    .eq("recipient_id", state.session.user.id)
    .order("created_at", { ascending: false })
    .limit(100);
  state.notifications = data || [];
}
const unreadNotificationCount = () =>
  state.notifications.filter((x) => !x.is_read).length;
async function markNotification(id) {
  await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("id", id)
    .eq("recipient_id", state.session.user.id);
  await loadNotifications();
  renderShell();
  navigate("notifications");
}
window.markNotification = markNotification;

async function renderSettings(page) {
  page.innerHTML = `<div class="pageHead"><div><div class="eyebrow">SETTINGS</div><h1>Account settings</h1><p>Manage your account and personalization.</p></div></div><div class="settingsGrid"><div class="card settingsCard"><h2>Account</h2><label>Email<input disabled value="${esc(state.session.user.email || "")}"></label><button class="secondary" id="resetPassword">Send password reset email</button></div><div class="card settingsCard"><h2>Smart feed</h2><p class="muted">Live Coders automatically learns from searches, communities, posts, likes and conversations to rank relevant developer content. There is no interest questionnaire.</p><div class="autoSignal"><span>●</span> Personalization is automatic</div></div><div class="card settingsCard"><h2>Session</h2><button class="danger" id="settingsLogout">Log out</button></div></div>`;
  document.querySelector("#resetPassword").onclick = async () => {
    const { error } = await supabase.auth.resetPasswordForEmail(
      state.session.user.email,
      { redirectTo: location.origin },
    );
    toast(error?.message || "Reset email sent.", error ? "error" : "success");
  };
  document.querySelector("#settingsLogout").onclick = () =>
    supabase.auth.signOut();
}
function modal(content) {
  closeModal();
  const el = document.createElement("div");
  el.id = "modalRoot";
  el.className = "modalBackdrop";
  el.innerHTML = `<div class="modal"><button class="modalClose" onclick="closeModal()">×</button>${content}</div>`;
  document.body.appendChild(el);
}
function closeModal() {
  document.querySelector("#modalRoot")?.remove();
}
window.closeModal = closeModal;

async function searchPeopleForMention(q = "") {
  const term = String(q || "").trim();
  if (!term) return [];
  const like = `%${term.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
  const { data, error } = await supabase
    .from("profiles")
    .select("id,username,display_name,full_name,avatar_url")
    .or(
      `username.ilike.${like},display_name.ilike.${like},full_name.ilike.${like}`,
    )
    .neq("id", state.session.user.id)
    .limit(8);
  if (error) throw error;
  return data || [];
}

function openPostModal(initialMode = "post") {
  const reelMode = initialMode === "reel";
  modal(
    `<h2>${reelMode ? "Post a build reel" : "Create a post"}</h2><p class="muted">${reelMode ? "Share what you are building with a short video." : "One page is a post. Add more pages and Live Coders automatically turns it into a blog."}</p><form id="postForm" class="postComposerForm"><label>Title<input name="title" required maxlength="180" placeholder="${reelMode ? "What are you building?" : "Give your post a clear title"}"></label><div id="postPages"><section class="composerBlogPage" data-page="1"><div class="sectionTitle"><strong>Page 1</strong></div><textarea class="blogPageText" rows="5" placeholder="${reelMode ? "Tell people what the reel shows…" : "Write your post…"}"></textarea><input class="blogPageImages" type="file" accept="image/*" multiple ${reelMode ? "disabled" : ""}><div class="pageImagePreview"></div></section></div><div class="composerPageActions"><button type="button" class="secondary" id="addBlogPage" ${reelMode ? "disabled" : ""}>+ Add page</button><span class="composerRule">1 page = Post · 2+ pages = Blog</span></div><div id="mediaField">${reelMode ? `<label>Build reel video<input name="media" type="file" accept="video/*" required></label>` : ""}</div><div class="mentionComposer"><label>Tag people</label><input id="mentionSearch" placeholder="Search @username or name"><div id="mentionResults" class="mentionResults"></div><div id="selectedMentions" class="selectedMentions"></div></div><label>Technology tags<input name="tags" placeholder="React, Supabase, JavaScript"></label><label>Category<select name="category"><option>Project Showcase</option><option>Developer Problem</option><option>Startup Discussion</option><option>Collaboration</option><option>Question</option><option>AI & Machine Learning</option><option>Web Development</option><option>Career & Jobs</option></select></label><button class="primary full">${reelMode ? "Publish reel" : "Publish"}</button></form>`,
  );
  const pageList = document.querySelector("#postPages");
  const selectedMentions = [];
  const wirePage = (wrap) => {
    wrap.querySelector(".blogPageImages")?.addEventListener("change", (e) => {
      const preview = wrap.querySelector(".pageImagePreview");
      preview.innerHTML = "";
      [...(e.target.files || [])].forEach((file) => {
        if (!file.type.startsWith("image/")) return;
        const img = document.createElement("img");
        img.src = URL.createObjectURL(file);
        img.alt = "Preview";
        preview.appendChild(img);
      });
    });
  };
  wirePage(pageList.firstElementChild);
  const addPage = () => {
    const index = pageList.children.length + 1;
    const wrap = document.createElement("section");
    wrap.className = "composerBlogPage";
    wrap.dataset.page = index;
    wrap.innerHTML = `<div class="sectionTitle"><strong>Page ${index}</strong><button type="button" class="linkButton removeBlogPage">Remove</button></div><textarea class="blogPageText" rows="5" placeholder="Write this page…"></textarea><input class="blogPageImages" type="file" accept="image/*" multiple><div class="pageImagePreview"></div>`;
    pageList.appendChild(wrap);
    wirePage(wrap);
    wrap.querySelector(".removeBlogPage").onclick = () => {
      wrap.remove();
      [...pageList.children].forEach(
        (el, i) => (el.querySelector("strong").textContent = `Page ${i + 1}`),
      );
    };
  };
  document.querySelector("#addBlogPage")?.addEventListener("click", addPage);
  const mentionInput = document.querySelector("#mentionSearch"),
    mentionResults = document.querySelector("#mentionResults"),
    selected = document.querySelector("#selectedMentions");
  const renderMentions = () => {
    selected.innerHTML = selectedMentions
      .map(
        (m) =>
          `<span class="mentionChip">@${esc(m.username)} <button type="button" data-id="${m.id}">×</button></span>`,
      )
      .join("");
    selected.querySelectorAll("button").forEach(
      (b) =>
        (b.onclick = () => {
          const i = selectedMentions.findIndex((m) => m.id === b.dataset.id);
          if (i >= 0) selectedMentions.splice(i, 1);
          renderMentions();
        }),
    );
  };
  let mentionTimer;
  mentionInput.oninput = () => {
    clearTimeout(mentionTimer);
    mentionTimer = setTimeout(async () => {
      try {
        const people = await searchPeopleForMention(
          mentionInput.value.replace(/^@/, ""),
        );
        mentionResults.innerHTML = people
          .map(
            (m) =>
              `<button type="button" class="mentionResult">${image(m.avatar_url, m.display_name || m.username, "avatar small")}<span><b>${esc(m.display_name || m.full_name || m.username)}</b><small>@${esc(m.username)}</small></span></button>`,
          )
          .join("");
        mentionResults.querySelectorAll("button").forEach(
          (b, i) =>
            (b.onclick = () => {
              const m = people[i];
              if (!selectedMentions.some((x) => x.id === m.id))
                selectedMentions.push(m);
              mentionInput.value = "";
              mentionResults.innerHTML = "";
              renderMentions();
            }),
        );
      } catch (err) {
        toast(err.message, "error");
      }
    }, 180);
  };
  document.querySelector("#postForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target),
      button = e.target.querySelector("button.primary");
    button.disabled = true;
    try {
      const pageEls = [...pageList.children];
      const bodyPages = [];
      for (const pageEl of pageEls) {
        const files = [
          ...(pageEl.querySelector(".blogPageImages")?.files || []),
        ];
        const images = [];
        for (const file of files) {
          if (!file.type.startsWith("image/")) continue;
          if (file.size > 8 * 1024 * 1024)
            throw new Error("Each image must be smaller than 8 MB.");
          const path = `${state.session.user.id}/posts/${crypto.randomUUID()}-${(file.name || "image").replace(/[^a-zA-Z0-9._-]/g, "_")}`;
          const up = await supabase.storage
            .from("post-media")
            .upload(path, file, {
              upsert: false,
              contentType: file.type,
              cacheControl: "3600",
            });
          if (up.error) throw up.error;
          images.push(
            supabase.storage.from("post-media").getPublicUrl(path).data
              .publicUrl,
          );
        }
        const text = pageEl.querySelector(".blogPageText")?.value.trim() || "";
        if (text || images.length) bodyPages.push({ text, images });
      }
      if (!bodyPages.length && !reelMode)
        throw new Error("Write something or add an image.");
      let mediaUrl = null,
        mediaType = null;
      if (reelMode) {
        const file = f.get("media");
        if (!file?.size) throw new Error("Choose a video for your reel.");
        if (file.size > 60 * 1024 * 1024)
          throw new Error("Reels must be smaller than 60 MB.");
        const path = `${state.session.user.id}/reels/${crypto.randomUUID()}-${(file.name || "reel").replace(/[^a-zA-Z0-9._-]/g, "_")}`;
        const up = await supabase.storage
          .from("post-media")
          .upload(path, file, {
            upsert: false,
            contentType: file.type || "video/mp4",
            cacheControl: "3600",
          });
        if (up.error) throw up.error;
        mediaUrl = supabase.storage.from("post-media").getPublicUrl(path)
          .data.publicUrl;
        mediaType = file.type || "video/mp4";
      }
      const autoType = reelMode
        ? "reel"
        : bodyPages.length > 1
          ? "blog"
          : "post";
      const firstText = bodyPages[0]?.text || "";
      const payload = {
        author_id: state.session.user.id,
        title: String(f.get("title")).trim(),
        content: firstText,
        tags: String(f.get("tags") || "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        category: String(f.get("category")),
        post_type: autoType,
        body_pages: bodyPages,
        media_url: mediaUrl,
        media_type: mediaType,
      };
      const { data: created, error } = await supabase
        .from("posts")
        .insert(payload)
        .select("id")
        .single();
      if (error) throw error;
      if (selectedMentions.length) {
        const rows = selectedMentions.map((m) => ({
          post_id: created.id,
          mentioned_user_id: m.id,
        }));
        const { error: mentionError } = await supabase
          .from("post_mentions")
          .insert(rows);
        if (mentionError) throw mentionError;
      }
      closeModal();
      toast(
        autoType === "blog"
          ? "Blog published."
          : autoType === "reel"
            ? "Reel published."
            : "Post published.",
        "success",
      );
      navigate("home");
    } catch (err) {
      toast(err.message || "Could not publish.", "error");
    } finally {
      button.disabled = false;
    }
  };
}
window.openPostModal = openPostModal;

async function uploadImage(file, bucket, path) {
  if (!file) return null;
  const allowed = ["image/png", "image/jpeg", "image/webp", "image/gif"];
  if (!allowed.includes(file.type))
    throw new Error("Please choose a PNG, JPG, WEBP or GIF image.");
  if (file.size > 5 * 1024 * 1024)
    throw new Error("Image must be smaller than 5 MB.");
  const ext = (file.name.split(".").pop() || "jpg")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  const final = `${path}.${ext}`;
  const { error } = await supabase.storage
    .from(bucket)
    .upload(final, file, {
      upsert: false,
      contentType: file.type,
      cacheControl: "3600",
    });
  if (error) throw error;
  return supabase.storage.from(bucket).getPublicUrl(final).data.publicUrl;
}

function openProfileModal() {
  const p = state.profile || {};
  modal(
    `<h2>Edit profile</h2><form id="profileForm"><label>Profile picture<input name="avatar" type="file" accept="image/*"></label><label>Display name<input name="displayName" value="${esc(p.display_name || p.full_name || "")}"></label><label>Bio<textarea name="bio" rows="4">${esc(p.bio || "")}</textarea></label><label>Location<input name="location" value="${esc(p.location || "")}"></label><label>Skills<input name="skills" value="${esc((p.skills || []).join(", "))}"></label><label>Experience<textarea name="experience" rows="4">${esc(p.experience || "")}</textarea></label><label>GitHub URL<input name="githubUrl" value="${esc(p.github_url || "")}"></label><label>LinkedIn URL<input name="linkedinUrl" value="${esc(p.linkedin_url || "")}"></label><label>Portfolio URL<input name="portfolioUrl" value="${esc(p.portfolio_url || "")}"></label><label>Website<input name="websiteUrl" value="${esc(p.website_url || "")}"></label><div class="sectionTitle"><h3>Projects</h3><button type="button" class="secondary" onclick="closeModal();openProjectModal()">+ Add project</button></div><button class="primary full">Save changes</button></form>`,
  );
  document.querySelector("#profileForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      let avatar = p.avatar_url;
      if (f.get("avatar")?.size)
        avatar = await uploadImage(
          f.get("avatar"),
          "avatars",
          `${state.session.user.id}/avatar`,
        );
      const patch = {
        avatar_url: avatar,
        display_name: f.get("displayName"),
        bio: f.get("bio"),
        location: f.get("location"),
        skills: String(f.get("skills"))
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        experience: f.get("experience"),
        github_url: f.get("githubUrl"),
        linkedin_url: f.get("linkedinUrl"),
        portfolio_url: f.get("portfolioUrl"),
        website_url: f.get("websiteUrl"),
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase
        .from("profiles")
        .update(patch)
        .eq("id", state.session.user.id);
      if (error) throw error;
      await profile();
      closeModal();
      renderShell();
      navigate("profile");
      toast("Profile updated.", "success");
    } catch (err) {
      toast(err.message, "error");
    }
  };
}
window.openProfileModal = openProfileModal;

function openProjectModal() {
  modal(
    `<h2>Add project</h2><form id="projectForm"><label>Project name<input name="name" required></label><label>Description<textarea name="description" rows="4"></textarea></label><label>Project URL<input name="url"></label><label>Repository URL<input name="repo"></label><label>Technologies<input name="tech" placeholder="Next.js, Supabase"></label><label>Community <select name="community"><option value="">No community</option></select></label><button class="primary full">Save project</button></form>`,
  );
  loadUserCommunityOptions();
  document.querySelector("#projectForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const { error } = await supabase.from("projects").insert({
      owner_id: state.session.user.id,
      name: f.get("name"),
      description: f.get("description"),
      url: f.get("url"),
      repository_url: f.get("repo"),
      technologies: String(f.get("tech"))
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
      community_id: f.get("community") || null,
    });
    if (error) toast(error.message, "error");
    else {
      closeModal();
      toast("Project added.", "success");
      navigate("profile");
    }
  };
}
window.openProjectModal = openProjectModal;
async function loadUserCommunityOptions() {
  const select = document.querySelector('[name="community"]');
  if (!select) return;
  try {
    const [
      { data: members, error: memberError },
      { data: created, error: createdError },
    ] = await Promise.all([
      supabase
        .from("community_members")
        .select("community_id")
        .eq("user_id", state.session.user.id),
      supabase
        .from("communities")
        .select("id,name")
        .eq("creator_id", state.session.user.id),
    ]);
    if (memberError || createdError) throw memberError || createdError;
    const ids = [
      ...new Set(
        [
          ...(members || []).map((x) => x.community_id),
          ...(created || []).map((x) => x.id),
        ].filter(Boolean),
      ),
    ];
    if (!ids.length) {
      select.innerHTML = '<option value="">No joined communities</option>';
      return;
    }
    const { data: communities, error: communityError } = await supabase
      .from("communities")
      .select("id,name")
      .in("id", ids)
      .order("name");
    if (communityError) throw communityError;
    select.innerHTML =
      '<option value="">No community</option>' +
      (communities || [])
        .map((c) => `<option value="${c.id}">${esc(c.name)}</option>`)
        .join("");
  } catch (err) {
    select.innerHTML = '<option value="">No joined communities</option>';
    console.error(err);
  }
}

async function openCommunityModal(id = null) {
  let c = null;
  if (id) {
    const r = await supabase
      .from("communities")
      .select("*")
      .eq("id", id)
      .single();
    if (r.error) return toast(r.error.message, "error");
    c = r.data;
    if (!c || c.creator_id !== state.session.user.id)
      return toast("Only the community creator can edit it.", "error");
  }
  modal(`<h2>${c ? "Edit" : "Create"} community</h2><form id="communityForm" class="communityForm">
    <div class="logoPicker"><div id="communityLogoPreview">${image(c?.logo_url, c?.name || "Community", "communityLogoPreviewImg")}</div><div><label>Community logo<input name="logo" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></label><small>PNG, JPG, WEBP or GIF · max 5 MB</small></div></div>
    <label>Name<input name="name" required maxlength="80" value="${esc(c?.name || "")}"></label>
    <label>Description<textarea name="description" required rows="4" maxlength="500">${esc(c?.description || "")}</textarea></label>
    <div class="modalTwoCol"><label>Community type<select name="category">${["Startups & Founders", "AI & Machine Learning", "Web Development", "Mobile Development", "Data Science", "Cybersecurity", "Cloud & DevOps", "Game Development", "Blockchain & Web3", "Open Source", "UI/UX & Design", "Programming Languages", "Career & Jobs", "Freelancing", "Robotics & IoT", "No-Code & Automation", "Trading & Finance"].map((x) => `<option value="${esc(x)}" ${c?.category === x || (!c && x === "Web Development") ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></label><label>Required skills<input name="skills" value="${esc((c?.required_skills || []).join(", "))}" placeholder="React, Python, founders"></label></div>
    <label>Rules<textarea name="rules" rows="4">${esc(c?.rules || "")}</textarea></label>
    <div class="modalTwoCol"><label>Location<input name="location" value="${esc(c?.location || "")}" placeholder="City, Country or Remote"></label><label>Remote mode<select name="remote"><option ${c?.remote_mode === "Remote" || !c ? "selected" : ""}>Remote</option><option ${c?.remote_mode === "Hybrid" ? "selected" : ""}>Hybrid</option><option ${c?.remote_mode === "Onsite" ? "selected" : ""}>Onsite</option></select></label></div>
    <label>Recruitment type<select name="recruitmentMode"><option value="open">Open — anyone can join instantly</option><option value="application">Application — head approves or denies</option><option value="closed">Closed — joining disabled</option></select></label>
    <button class="primary full" id="communitySaveBtn">${c ? "Save changes" : "Create community"}</button>
  </form>`);
  const form = document.querySelector("#communityForm");
  const categorySelect = form.querySelector('[name="category"]');
  if (categorySelect && c?.category) categorySelect.value = c.category;
  const recruitmentModeSelect = form.querySelector('[name="recruitmentMode"]');
  if (recruitmentModeSelect)
    recruitmentModeSelect.value =
      c?.recruitment_mode ||
      (!c?.recruitment_enabled ? "closed" : "application");
  const fileInput = form.querySelector('[name="logo"]');
  fileInput.onchange = () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    const img = document.createElement("img");
    img.className = "communityLogoPreviewImg";
    img.alt = "Community logo preview";
    img.src = URL.createObjectURL(f);
    document.querySelector("#communityLogoPreview").replaceChildren(img);
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const button = document.querySelector("#communitySaveBtn");
    button.disabled = true;
    button.textContent = c ? "Saving…" : "Creating…";
    const f = new FormData(form);
    try {
      const base = {
        name: String(f.get("name")).trim(),
        description: String(f.get("description")).trim(),
        category: String(f.get("category") || "").trim(),
        skills_input: String(f.get("skills") || "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        rules: String(f.get("rules") || "").trim(),
        remote: String(f.get("remote") || "Remote"),
        recruitmentMode: String(f.get("recruitmentMode") || "closed"),
        recruitment: ["open", "application"].includes(
          String(f.get("recruitmentMode") || ""),
        ),
        location: String(f.get("location") || "").trim(),
      };
      if (!base.name || !base.description)
        throw new Error("Name and description are required.");
      let communityId = id;
      if (!c) {
        const r = await supabase.rpc("create_community", {
          name_input: base.name,
          description_input: base.description,
          category_input: base.category,
          skills_input: base.skills_input,
          rules_input: base.rules,
          remote_mode_input: base.remote,
          recruitment_input: base.recruitment,
          location_input: base.location,
          logo_url_input: null,
          recruitment_mode_input: base.recruitmentMode,
        });
        if (r.error) throw r.error;
        communityId = r.data;
      }
      let logoUrl = c?.logo_url || null;
      if (fileInput.files?.[0]) {
        const safePath = `${state.session.user.id}/${communityId}/${crypto.randomUUID()}`;
        logoUrl = await uploadImage(
          fileInput.files[0],
          "community-avatars",
          safePath,
        );
      }
      const r = await supabase.rpc("update_community", {
        community_id_input: communityId,
        name_input: base.name,
        description_input: base.description,
        category_input: base.category,
        skills_input: base.skills_input,
        rules_input: base.rules,
        remote_mode_input: base.remote,
        recruitment_input: base.recruitment,
        location_input: base.location,
        logo_url_input: logoUrl,
        recruitment_mode_input: base.recruitmentMode,
      });
      if (r.error) throw r.error;
      state.cache.communities.at = 0;
      state.cache.search.clear();
      closeModal();
      toast(c ? "Community updated." : "Community created.", "success");
      navigate(`community?id=${communityId}`);
    } catch (err) {
      toast(err.message || "Could not save community.", "error");
      button.disabled = false;
      button.textContent = c ? "Save changes" : "Create community";
    }
  };
}
window.openCommunityModal = openCommunityModal;

window.openCommunityEventModal = async function (communityId) {
  modal(
    `<h2>Add community event</h2><form id="eventForm"><label>Event title<input name="title" required maxlength="120"></label><label>Description<textarea name="description" rows="3"></textarea></label><label>Starts at<input name="starts" type="datetime-local" required></label><label>Ends at<input name="ends" type="datetime-local"></label><label>Meeting URL<input name="url" placeholder="https://…"></label><button class="primary full">Create event</button></form>`,
  );
  document.querySelector("#eventForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const { error } = await supabase
      .from("community_events")
      .insert({
        community_id: communityId,
        creator_id: state.session.user.id,
        title: String(f.get("title")),
        description: String(f.get("description") || ""),
        starts_at: new Date(f.get("starts")).toISOString(),
        ends_at: f.get("ends") ? new Date(f.get("ends")).toISOString() : null,
        meeting_url: String(f.get("url") || ""),
      });
    if (error) toast(error.message, "error");
    else {
      closeModal();
      toast("Event created.", "success");
      renderCommunityWorkspace(document.querySelector("#page"), communityId);
    }
  };
};
window.openCommunityFileModal = async function (communityId) {
  modal(
    `<h2>Add shared resource</h2><form id="fileForm"><label>Name<input name="name" required maxlength="160"></label><label>URL<input name="url" type="url" required placeholder="https://…"></label><label>Type<input name="type" placeholder="PDF, Design, Docs…"></label><button class="primary full">Add resource</button></form>`,
  );
  document.querySelector("#fileForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const { error } = await supabase
      .from("community_files")
      .insert({
        community_id: communityId,
        uploader_id: state.session.user.id,
        name: String(f.get("name")),
        url: String(f.get("url")),
        file_type: String(f.get("type") || ""),
      });
    if (error) toast(error.message, "error");
    else {
      closeModal();
      toast("Resource added.", "success");
      renderCommunityWorkspace(document.querySelector("#page"), communityId);
    }
  };
};

function subscribeRealtime() {
  if (state.realtime) state.realtime.unsubscribe();
  state.realtime = supabase
    .channel("live-coders-live")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "messages" },
      async (p) => {
        if (
          state.route === "messages" &&
          p.new?.conversation_id === state.selectedConversation
        )
          refreshDirectMessages(state.selectedConversation, true);
      },
    )
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: `recipient_id=eq.${state.session.user.id}`,
      },
      async () => {
        await loadNotifications();
        const b = document.querySelector("#notifBadge");
        if (b) {
          b.textContent = unreadNotificationCount();
          b.classList.toggle("hidden", !unreadNotificationCount());
        }
      },
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "community_messages" },
      async (p) => {
        if (state.route === "community") {
          const id = new URLSearchParams(location.hash.split("?")[1] || "").get(
            "id",
          );
          if (id === p.new?.community_id) refreshCommunityChat(id);
        }
      },
    )
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "post_comments" },
      async () => {
        if (state.route === "home") navigate("home");
      },
    )
    .subscribe();
}

bootstrap();
