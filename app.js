const TABLES = {
  users: "Utilisateurs",
  channels: "Canaux",
  memberships: "Membres_canaux",
  posts: "Publications",
  comments: "Commentaires"
};

let channels = [];
let memberships = [];
let posts = [];
let comments = [];
let users = [];

let currentChannel = null;
let currentUserId = null;

let postQuill = null;
let editQuill = null;

let editState = null;

const replyQuills = new Map();
const expandedThreads = new Set();

grist.ready({
  requiredAccess: "full"
});


/* ==========================================================
   QUILL
========================================================== */

const POST_TOOLBAR = [
  ["bold", "italic", "underline", "strike"],
  [{ header: [2, 3, false] }],
  [{ list: "ordered" }, { list: "bullet" }],
  ["blockquote"],
  ["link"],
  ["clean"]
];

const REPLY_TOOLBAR = [
  ["bold", "italic", "underline"],
  [{ list: "bullet" }],
  ["link"],
  ["clean"]
];

function initEditors() {

  postQuill = new Quill(
    "#post-editor",
    {
      theme: "snow",
      placeholder: "Écrivez votre publication…",
      modules: {
        toolbar: POST_TOOLBAR
      }
    }
  );

  editQuill = new Quill(
    "#edit-editor",
    {
      theme: "snow",
      placeholder: "Modifier le message…",
      modules: {
        toolbar: POST_TOOLBAR
      }
    }
  );
}


/* ==========================================================
   OUTILS GRIST
========================================================== */

function rowsFromTable(table) {

  if (!table || !table.id) {
    return [];
  }

  return table.id.map(
    (id, index) => {

      const row = { id };

      Object.keys(table).forEach(
        column => {

          if (column !== "id") {
            row[column] =
              table[column][index];
          }

        }
      );

      return row;
    }
  );
}


/* ==========================================================
   UTILISATEURS
========================================================== */

function getUser(id) {

  return users.find(
    user =>
      Number(user.id) === Number(id)
  );
}

function getUserName(id) {

  const user =
    getUser(id);

  if (!user) {
    return "Utilisateur";
  }

  return (
    user.Nom_affiche ||
    [
      user.Prenom,
      user.Nom
    ]
      .filter(Boolean)
      .join(" ") ||
    "Utilisateur"
  );
}

function getInitials(id) {

  const user =
    getUser(id);

  if (!user) {
    return "?";
  }

  if (user.Initiales) {
    return user.Initiales;
  }

  return getUserName(id)
    .split(" ")
    .map(part => part[0])
    .join("")
    .substring(0, 2)
    .toUpperCase();
}

function isMine(authorId) {

  return (
    Number(authorId) ===
    Number(currentUserId)
  );
}


/* ==========================================================
   MEMBRES / ADMINISTRATEURS
========================================================== */

function getMembership(
  userId,
  channelId
) {

  return memberships.find(
    membership =>
      Number(membership.Utilisateur) ===
        Number(userId) &&

      Number(membership.Canal) ===
        Number(channelId) &&

      membership.Actif !== false
  );
}

function isChannelAdmin(
  userId,
  channelId
) {

  const membership =
    getMembership(
      userId,
      channelId
    );

  if (!membership) {
    return false;
  }

  return (
    String(
      membership.Role_canal || ""
    )
      .toLowerCase()
      .includes("admin")
  );
}


/* ==========================================================
   DATE
========================================================== */

function toDate(value) {

  if (!value) {
    return null;
  }

  if (
    typeof value === "number" &&
    value < 100000000000
  ) {
    return new Date(
      value * 1000
    );
  }

  return new Date(value);
}

function relativeDate(value) {

  const date =
    toDate(value);

  if (
    !date ||
    Number.isNaN(date.getTime())
  ) {
    return "";
  }

  const now =
    new Date();

  const diff =
    now.getTime() -
    date.getTime();

  const minutes =
    Math.floor(
      diff / 60000
    );

  if (minutes < 1) {
    return "à l’instant";
  }

  if (minutes < 60) {
    return `il y a ${minutes} min`;
  }

  const hours =
    Math.floor(
      minutes / 60
    );

  if (hours < 24) {
    return `il y a ${hours} h`;
  }

  const yesterday =
    new Date(now);

  yesterday.setDate(
    now.getDate() - 1
  );

  if (
    date.toDateString() ===
    yesterday.toDateString()
  ) {
    return (
      "hier à " +
      new Intl.DateTimeFormat(
        "fr-FR",
        {
          hour: "2-digit",
          minute: "2-digit"
        }
      ).format(date)
    );
  }

  if (hours < 168) {

    return new Intl.DateTimeFormat(
      "fr-FR",
      {
        weekday: "long",
        hour: "2-digit",
        minute: "2-digit"
      }
    ).format(date);

  }

  return new Intl.DateTimeFormat(
    "fr-FR",
    {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }
  ).format(date);
}


/* ==========================================================
   HTML / RICH TEXT
========================================================== */

function escapeHtml(value) {

  if (
    value === null ||
    value === undefined
  ) {
    return "";
  }

  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function looksLikeHtml(value) {

  return /<\/?[a-z][\s\S]*>/i
    .test(
      String(value || "")
    );
}

function normalizeContent(value) {

  if (!value) {
    return "";
  }

  if (looksLikeHtml(value)) {
    return value;
  }

  return (
    "<p>" +
    escapeHtml(value)
      .replaceAll(
        "\n",
        "<br>"
      ) +
    "</p>"
  );
}

function sanitizeHtml(value) {

  return DOMPurify.sanitize(
    normalizeContent(value),
    {
      USE_PROFILES: {
        html: true
      }
    }
  );
}


/*
 * Mentions V0.4 :
 * @Jules, @Sylvain, etc.
 *
 * Elles sont visuelles uniquement.
 * Les vraies notifications viendront plus tard.
 */

function decorateMentions(html) {

  const container =
    document.createElement("div");

  container.innerHTML =
    sanitizeHtml(html);

  const mentionNames =
    users
      .map(user => user.Prenom)
      .filter(Boolean)
      .sort(
        (a, b) =>
          b.length - a.length
      );

  if (!mentionNames.length) {
    return container.innerHTML;
  }

  const escapedNames =
    mentionNames.map(
      name =>
        name.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        )
    );

  const regex =
    new RegExp(
      `@(${escapedNames.join("|")})\\b`,
      "gi"
    );

  const walker =
    document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT
    );

  const nodes = [];

  while (walker.nextNode()) {
    nodes.push(
      walker.currentNode
    );
  }

  nodes.forEach(node => {

    const text =
      node.nodeValue;

    if (!regex.test(text)) {
      regex.lastIndex = 0;
      return;
    }

    regex.lastIndex = 0;

    const fragment =
      document.createDocumentFragment();

    let lastIndex = 0;

    text.replace(
      regex,
      (match, name, offset) => {

        fragment.appendChild(
          document.createTextNode(
            text.slice(
              lastIndex,
              offset
            )
          )
        );

        const span =
          document.createElement("span");

        span.className =
          "mention";

        span.textContent =
          match;

        fragment.appendChild(span);

        lastIndex =
          offset +
          match.length;

      }
    );

    fragment.appendChild(
      document.createTextNode(
        text.slice(lastIndex)
      )
    );

    node.parentNode.replaceChild(
      fragment,
      node
    );
  });

  return container.innerHTML;
}

function editorIsEmpty(quill) {

  return (
    quill
      .getText()
      .trim()
      .length === 0
  );
}

function getEditorHtml(quill) {

  return DOMPurify.sanitize(
    quill.root.innerHTML
  );
}


/* ==========================================================
   UTILISATEUR ACTIF
========================================================== */

function renderCurrentUserSelector() {

  const select =
    document.getElementById(
      "current-user-select"
    );

  select.innerHTML = "";

  const activeUsers =
    users.filter(
      user =>
        user.Actif !== false
    );

  activeUsers.forEach(
    user => {

      const option =
        document.createElement(
          "option"
        );

      option.value =
        user.id;

      option.textContent =
        getUserName(user.id);

      select.appendChild(
        option
      );
    }
  );

  if (
    !currentUserId &&
    activeUsers.length
  ) {
    currentUserId =
      activeUsers[0].id;
  }

  select.value =
    currentUserId || "";

  select.onchange =
    () => {

      currentUserId =
        Number(
          select.value
        );

      closeComposer();

      renderChannels();
      renderFeed();

    };

  updateComposerPermissions();
}


/* ==========================================================
   CANAUX
========================================================== */

function renderChannels() {

  const container =
    document.getElementById(
      "channels"
    );

  container.innerHTML = "";

  [...channels]
    .sort(
      (a, b) =>
        (a.Ordre || 0) -
        (b.Ordre || 0)
    )
    .forEach(
      channel => {

        const button =
          document.createElement(
            "button"
          );

        button.className =
          "channel" +
          (
            currentChannel &&
            Number(
              currentChannel.id
            ) ===
            Number(
              channel.id
            )
              ? " active"
              : ""
          );

        const isPrivate =
          String(
            channel.Type_acces ||
            ""
          )
            .toLowerCase()
            .includes(
              "encadrement"
            );

        button.textContent =
          (
            isPrivate
              ? "🔒 "
              : "# "
          ) +
          (
            channel.Nom ||
            "Canal"
          );

        button.addEventListener(
          "click",
          () => {

            currentChannel =
              channel;

            closeComposer();

            renderChannels();
            renderFeed();

            updateComposerPermissions();

          }
        );

        container.appendChild(
          button
        );
      }
    );
}


/* ==========================================================
   FEED
========================================================== */

function renderFeed() {

  destroyReplyEditors();

  const feed =
    document.getElementById(
      "feed"
    );

  const title =
    document.getElementById(
      "channel-title"
    );

  const description =
    document.getElementById(
      "channel-description"
    );

  if (!currentChannel) {

    feed.innerHTML =
      '<div class="message">Aucun canal disponible.</div>';

    return;
  }

  title.textContent =
    "# " +
    currentChannel.Nom;

  description.textContent =
    currentChannel.Description ||
    "";

  let channelPosts =
    posts.filter(
      post =>
        Number(post.Canal) ===
          Number(
            currentChannel.id
          ) &&
        !post.Archive
    );

  channelPosts.sort(
    (a, b) => {

      if (
        !!a.Epingle !==
        !!b.Epingle
      ) {
        return (
          a.Epingle
            ? -1
            : 1
        );
      }

      const aDate =
        toDate(
          a.Date_creation
        );

      const bDate =
        toDate(
          b.Date_creation
        );

      return (
        (bDate?.getTime() || 0) -
        (aDate?.getTime() || 0)
      );
    }
  );

  if (!channelPosts.length) {

    feed.innerHTML =
      '<div class="message">Aucune publication dans ce canal.</div>';

    return;
  }

  feed.innerHTML = "";

  channelPosts.forEach(
    post => {

      const article =
        renderPost(post);

      feed.appendChild(
        article
      );

    }
  );
}

function renderPost(post) {

  const article =
    document.createElement(
      "article"
    );

  const type =
    post.Type_publication ||
    "Publication";

  const announcement =
    String(type)
      .toLowerCase() ===
    "annonce";

  article.className =
    "post" +
    (
      announcement
        ? " announcement"
        : ""
    );

  article.dataset.postId =
    post.id;

  const postComments =
    comments
      .filter(
        comment =>
          Number(
            comment.Publication
          ) ===
            Number(post.id) &&
          !comment.Supprime
      )
      .sort(
        (a, b) =>
          (toDate(
            a.Date_creation
          )?.getTime() || 0) -
          (toDate(
            b.Date_creation
          )?.getTime() || 0)
      );

  const canEdit =
    isMine(post.Auteur);

  const canPin =
    currentChannel &&
    isChannelAdmin(
      currentUserId,
      currentChannel.id
    );

  const expanded =
    expandedThreads.has(
      Number(post.id)
    );

  article.innerHTML = `

    ${
      announcement
        ? `
          <div class="announcement-label">
            📣 Annonce
          </div>
        `
        : ""
    }

    ${
      post.Epingle
        ? `
          <div class="pin">
            📌 Publication épinglée
          </div>
        `
        : ""
    }

    <div class="post-meta">

      <div class="avatar">
        ${escapeHtml(
          getInitials(
            post.Auteur
          )
        )}
      </div>

      <div>

        <div class="author">
          ${escapeHtml(
            getUserName(
              post.Auteur
            )
          )}
        </div>

        <div class="date">

          ${escapeHtml(
            relativeDate(
              post.Date_creation
            )
          )}

          ${
            post.Modifie
              ? " · modifié"
              : ""
          }

        </div>

      </div>

    </div>

    <div class="post-title">
      ${escapeHtml(
        post.Titre
      )}
    </div>

    <div class="rich-content">
      ${decorateMentions(
        post.Contenu
      )}
    </div>

    ${
      post.Lien
        ? `
          <a
            class="post-link"
            href="${escapeHtml(
              post.Lien
            )}"
            target="_blank"
            rel="noopener noreferrer"
          >
            🔗 Ouvrir le lien
          </a>
        `
        : ""
    }

    <div class="post-actions">

      ${
        canEdit
          ? `
            <button
              class="text-button edit-post"
              data-post-id="${post.id}"
            >
              Modifier
            </button>

            <button
              class="text-button danger-button delete-post"
              data-post-id="${post.id}"
            >
              Supprimer
            </button>
          `
          : ""
      }

      ${
        canPin
          ? `
            <button
              class="text-button toggle-pin"
              data-post-id="${post.id}"
            >
              ${
                post.Epingle
                  ? "Désépingler"
                  : "Épingler"
              }
            </button>
          `
          : ""
      }

    </div>

    <div class="thread-divider"></div>

    <div class="comments-header">

      <span class="comments-count">

        ${
          postComments.length === 0
            ? "Aucune réponse"
            : postComments.length === 1
              ? "1 réponse"
              : `${postComments.length} réponses`
        }

      </span>

      ${
        postComments.length > 2
          ? `
            <button
              class="text-button toggle-comments"
              data-post-id="${post.id}"
            >
              ${
                expanded
                  ? "Réduire"
                  : `Afficher les ${postComments.length} réponses`
              }
            </button>
          `
          : ""
      }

    </div>

    <div
      class="comments-list ${
        expanded
          ? ""
          : "collapsed"
      }"
    >
      ${postComments
        .map(
          comment =>
            renderCommentHtml(
              comment
            )
        )
        .join("")
      }
    </div>

    <button
      class="text-button reply-trigger"
      data-post-id="${post.id}"
    >
      ↩ Répondre
    </button>

    <div
      id="reply-${post.id}"
      class="reply-composer hidden"
    >

      <div
        id="reply-editor-${post.id}"
        class="reply-editor"
      ></div>

      <div class="reply-actions">

        <button
          class="secondary cancel-reply"
          data-post-id="${post.id}"
        >
          Annuler
        </button>

        <button
          class="primary send-reply"
          data-post-id="${post.id}"
        >
          Envoyer
        </button>

      </div>

    </div>
  `;

  attachPostEvents(
    article,
    post
  );

  return article;
}

function renderCommentHtml(
  comment
) {

  const canEdit =
    isMine(
      comment.Auteur
    );

  return `
    <div
      class="comment"
      data-comment-id="${comment.id}"
    >

      <div class="comment-header">

        <span class="comment-author">
          ${escapeHtml(
            getUserName(
              comment.Auteur
            )
          )}
        </span>

        <span class="comment-date">
          ${escapeHtml(
            relativeDate(
              comment.Date_creation
            )
          )}
        </span>

        ${
          comment.Modifie
            ? `
              <span class="edited">
                modifié
              </span>
            `
            : ""
        }

      </div>

      <div class="comment-content rich-content">
        ${decorateMentions(
          comment.Contenu
        )}
      </div>

      ${
        canEdit
          ? `
            <div class="comment-actions">

              <button
                class="text-button edit-comment"
                data-comment-id="${comment.id}"
              >
                Modifier
              </button>

              <button
                class="text-button danger-button delete-comment"
                data-comment-id="${comment.id}"
              >
                Supprimer
              </button>

            </div>
          `
          : ""
      }

    </div>
  `;
}


/* ==========================================================
   EVENEMENTS THREAD
========================================================== */

function attachPostEvents(
  article,
  post
) {

  const replyTrigger =
    article.querySelector(
      ".reply-trigger"
    );

  replyTrigger.addEventListener(
    "click",
    () => openReplyEditor(
      article,
      post.id
    )
  );

  const cancelReply =
    article.querySelector(
      ".cancel-reply"
    );

  cancelReply.addEventListener(
    "click",
    () => closeReplyEditor(
      post.id
    )
  );

  const sendReply =
    article.querySelector(
      ".send-reply"
    );

  sendReply.addEventListener(
    "click",
    () => sendReplyForPost(
      post.id
    )
  );

  const editPost =
    article.querySelector(
      ".edit-post"
    );

  if (editPost) {

    editPost.addEventListener(
      "click",
      () =>
        openPostEditor(
          post.id
        )
    );

  }

  const deletePostButton =
    article.querySelector(
      ".delete-post"
    );

  if (deletePostButton) {

    deletePostButton.addEventListener(
      "click",
      () =>
        deletePost(
          post.id
        )
    );

  }

  const pinButton =
    article.querySelector(
      ".toggle-pin"
    );

  if (pinButton) {

    pinButton.addEventListener(
      "click",
      () =>
        togglePin(
          post.id
        )
    );

  }

  const toggleComments =
    article.querySelector(
      ".toggle-comments"
    );

  if (toggleComments) {

    toggleComments.addEventListener(
      "click",
      () => {

        const id =
          Number(post.id);

        if (
          expandedThreads.has(id)
        ) {
          expandedThreads.delete(id);
        } else {
          expandedThreads.add(id);
        }

        renderFeed();

      }
    );

  }

  article
    .querySelectorAll(
      ".edit-comment"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () =>
            openCommentEditor(
              Number(
                button.dataset.commentId
              )
            )
        );

      }
    );

  article
    .querySelectorAll(
      ".delete-comment"
    )
    .forEach(
      button => {

        button.addEventListener(
          "click",
          () =>
            deleteComment(
              Number(
                button.dataset.commentId
              )
            )
        );

      }
    );
}


/* ==========================================================
   REPONSES RICH TEXT
========================================================== */

function openReplyEditor(
  article,
  postId
) {

  const wrapper =
    article.querySelector(
      `#reply-${postId}`
    );

  wrapper.classList.remove(
    "hidden"
  );

  if (
    !replyQuills.has(
      Number(postId)
    )
  ) {

    const quill =
      new Quill(
        `#reply-editor-${postId}`,
        {
          theme: "snow",

          placeholder:
            `Répondre en tant que ${getUserName(
              currentUserId
            )}…`,

          modules: {
            toolbar:
              REPLY_TOOLBAR
          }
        }
      );

    replyQuills.set(
      Number(postId),
      quill
    );
  }

  replyQuills
    .get(Number(postId))
    .focus();
}

function closeReplyEditor(
  postId
) {

  const wrapper =
    document.getElementById(
      `reply-${postId}`
    );

  if (wrapper) {
    wrapper.classList.add(
      "hidden"
    );
  }

  const quill =
    replyQuills.get(
      Number(postId)
    );

  if (quill) {
    quill.setContents([]);
  }
}

function destroyReplyEditors() {

  replyQuills.clear();
}

async function sendReplyForPost(
  postId
) {

  const quill =
    replyQuills.get(
      Number(postId)
    );

  if (
    !quill ||
    editorIsEmpty(quill)
  ) {
    return;
  }

  const content =
    getEditorHtml(quill);

  await createComment(
    postId,
    currentUserId,
    content
  );
}


/* ==========================================================
   NOUVELLE PUBLICATION
========================================================== */

function updateComposerPermissions() {

  const wrapper =
    document.getElementById(
      "post-pin-wrapper"
    );

  if (
    currentChannel &&
    isChannelAdmin(
      currentUserId,
      currentChannel.id
    )
  ) {
    wrapper.classList.remove(
      "hidden"
    );
  } else {
    wrapper.classList.add(
      "hidden"
    );

    document.getElementById(
      "post-pin"
    ).checked = false;
  }
}

function openComposer() {

  updateComposerPermissions();

  document
    .getElementById(
      "composer"
    )
    .classList.remove(
      "hidden"
    );

  document
    .getElementById(
      "post-title"
    )
    .focus();
}

function closeComposer() {

  document
    .getElementById(
      "composer"
    )
    .classList.add(
      "hidden"
    );

  document.getElementById(
    "post-title"
  ).value = "";

  document.getElementById(
    "post-link"
  ).value = "";

  document.getElementById(
    "post-type"
  ).value =
    "Publication";

  document.getElementById(
    "post-pin"
  ).checked = false;

  document.getElementById(
    "composer-message"
  ).innerHTML = "";

  if (postQuill) {
    postQuill.setContents([]);
  }
}

async function createPost() {

  if (
    !currentChannel ||
    !currentUserId
  ) {
    return;
  }

  const title =
    document
      .getElementById(
        "post-title"
      )
      .value
      .trim();

  const type =
    document
      .getElementById(
        "post-type"
      )
      .value;

  const link =
    document
      .getElementById(
        "post-link"
      )
      .value
      .trim();

  const canPin =
    isChannelAdmin(
      currentUserId,
      currentChannel.id
    );

  const pin =
    canPin &&
    document.getElementById(
      "post-pin"
    ).checked;

  if (
    !title ||
    editorIsEmpty(postQuill)
  ) {

    document.getElementById(
      "composer-message"
    ).innerHTML =
      `
        <div class="error">
          Le titre et le message sont obligatoires.
        </div>
      `;

    return;
  }

  const content =
    getEditorHtml(
      postQuill
    );

  try {

    await grist.docApi.applyUserActions(
      [
        [
          "AddRecord",
          TABLES.posts,
          null,
          {
            Canal:
              currentChannel.id,

            Auteur:
              currentUserId,

            Date_creation:
              Date.now() / 1000,

            Titre:
              title,

            Contenu:
              content,

            Type_publication:
              type,

            Epingle:
              pin,

            Lien:
              link,

            Archive:
              false
          }
        ]
      ]
    );

    closeComposer();

    await loadData();

  } catch (error) {

    console.error(error);

    document.getElementById(
      "composer-message"
    ).innerHTML =
      `
        <div class="error">
          Impossible de publier :
          ${escapeHtml(
            error.message ||
            error
          )}
        </div>
      `;
  }
}


/* ==========================================================
   COMMENTAIRES
========================================================== */

async function createComment(
  postId,
  authorId,
  content
) {

  await grist.docApi.applyUserActions(
    [
      [
        "AddRecord",
        TABLES.comments,
        null,
        {
          Publication:
            postId,

          Auteur:
            authorId,

          Date_creation:
            Date.now() / 1000,

          Contenu:
            DOMPurify.sanitize(
              content
            ),

          Supprime:
            false
        }
      ]
    ]
  );

  expandedThreads.add(
    Number(postId)
  );

  await loadData();
}


/* ==========================================================
   EDITION
========================================================== */

function openPostEditor(
  postId
) {

  const post =
    posts.find(
      p =>
        Number(p.id) ===
        Number(postId)
    );

  if (
    !post ||
    !isMine(
      post.Auteur
    )
  ) {
    return;
  }

  editState = {
    type: "post",
    id: post.id
  };

  document.getElementById(
    "edit-modal-title"
  ).textContent =
    "Modifier la publication";

  document.getElementById(
    "edit-post-fields"
  ).classList.remove(
    "hidden"
  );

  document.getElementById(
    "edit-link-field"
  ).classList.remove(
    "hidden"
  );

  const canPin =
    isChannelAdmin(
      currentUserId,
      post.Canal
    );

  document.getElementById(
    "edit-pin-field"
  ).classList.toggle(
    "hidden",
    !canPin
  );

  document.getElementById(
    "edit-type"
  ).value =
    post.Type_publication ||
    "Publication";

  document.getElementById(
    "edit-title"
  ).value =
    post.Titre || "";

  document.getElementById(
    "edit-link"
  ).value =
    post.Lien || "";

  document.getElementById(
    "edit-pin"
  ).checked =
    !!post.Epingle;

  editQuill.root.innerHTML =
    sanitizeHtml(
      post.Contenu
    );

  document.getElementById(
    "edit-modal"
  ).classList.remove(
    "hidden"
  );
}

function openCommentEditor(
  commentId
) {

  const comment =
    comments.find(
      c =>
        Number(c.id) ===
        Number(commentId)
    );

  if (
    !comment ||
    !isMine(
      comment.Auteur
    )
  ) {
    return;
  }

  editState = {
    type: "comment",
    id: comment.id
  };

  document.getElementById(
    "edit-modal-title"
  ).textContent =
    "Modifier la réponse";

  document.getElementById(
    "edit-post-fields"
  ).classList.add(
    "hidden"
  );

  document.getElementById(
    "edit-link-field"
  ).classList.add(
    "hidden"
  );

  document.getElementById(
    "edit-pin-field"
  ).classList.add(
    "hidden"
  );

  editQuill.root.innerHTML =
    sanitizeHtml(
      comment.Contenu
    );

  document.getElementById(
    "edit-modal"
  ).classList.remove(
    "hidden"
  );
}

function closeEditModal() {

  editState = null;

  document.getElementById(
    "edit-modal"
  ).classList.add(
    "hidden"
  );

  if (editQuill) {
    editQuill.setContents([]);
  }
}

async function saveEdit() {

  if (
    !editState ||
    editorIsEmpty(
      editQuill
    )
  ) {
    return;
  }

  const content =
    getEditorHtml(
      editQuill
    );

  if (
    editState.type ===
    "post"
  ) {

    const post =
      posts.find(
        p =>
          Number(p.id) ===
          Number(editState.id)
      );

    if (
      !post ||
      !isMine(
        post.Auteur
      )
    ) {
      return;
    }

    const title =
      document
        .getElementById(
          "edit-title"
        )
        .value
        .trim();

    if (!title) {
      return;
    }

    const canPin =
      isChannelAdmin(
        currentUserId,
        post.Canal
      );

    const fields = {

      Titre:
        title,

      Contenu:
        content,

      Type_publication:
        document.getElementById(
          "edit-type"
        ).value,

      Lien:
        document
          .getElementById(
            "edit-link"
          )
          .value
          .trim(),

      Modifie:
        true,

      Date_modification:
        Date.now() / 1000
    };

    if (canPin) {

      fields.Epingle =
        document.getElementById(
          "edit-pin"
        ).checked;

    }

    await grist.docApi.applyUserActions(
      [
        [
          "UpdateRecord",
          TABLES.posts,
          post.id,
          fields
        ]
      ]
    );

  } else {

    const comment =
      comments.find(
        c =>
          Number(c.id) ===
          Number(editState.id)
      );

    if (
      !comment ||
      !isMine(
        comment.Auteur
      )
    ) {
      return;
    }

    await grist.docApi.applyUserActions(
      [
        [
          "UpdateRecord",
          TABLES.comments,
          comment.id,
          {
            Contenu:
              content,

            Modifie:
              true,

            Date_modification:
              Date.now() / 1000
          }
        ]
      ]
    );
  }

  closeEditModal();

  await loadData();
}


/* ==========================================================
   SUPPRESSION / EPINGLAGE
========================================================== */

async function deletePost(
  postId
) {

  const post =
    posts.find(
      p =>
        Number(p.id) ===
        Number(postId)
    );

  if (
    !post ||
    !isMine(
      post.Auteur
    )
  ) {
    return;
  }

  if (
    !confirm(
      "Supprimer cette publication ?"
    )
  ) {
    return;
  }

  await grist.docApi.applyUserActions(
    [
      [
        "UpdateRecord",
        TABLES.posts,
        post.id,
        {
          Archive: true
        }
      ]
    ]
  );

  await loadData();
}

async function deleteComment(
  commentId
) {

  const comment =
    comments.find(
      c =>
        Number(c.id) ===
        Number(commentId)
    );

  if (
    !comment ||
    !isMine(
      comment.Auteur
    )
  ) {
    return;
  }

  if (
    !confirm(
      "Supprimer cette réponse ?"
    )
  ) {
    return;
  }

  await grist.docApi.applyUserActions(
    [
      [
        "UpdateRecord",
        TABLES.comments,
        comment.id,
        {
          Supprime: true
        }
      ]
    ]
  );

  await loadData();
}

async function togglePin(
  postId
) {

  const post =
    posts.find(
      p =>
        Number(p.id) ===
        Number(postId)
    );

  if (!post) {
    return;
  }

  if (
    !isChannelAdmin(
      currentUserId,
      post.Canal
    )
  ) {
    return;
  }

  await grist.docApi.applyUserActions(
    [
      [
        "UpdateRecord",
        TABLES.posts,
        post.id,
        {
          Epingle:
            !post.Epingle
        }
      ]
    ]
  );

  await loadData();
}


/* ==========================================================
   CHARGEMENT
========================================================== */

async function loadData() {

  try {

    const previousChannelId =
      currentChannel
        ? currentChannel.id
        : null;

    const [
      channelsRaw,
      membershipsRaw,
      postsRaw,
      commentsRaw,
      usersRaw
    ] =
      await Promise.all(
        [

          grist.docApi.fetchTable(
            TABLES.channels
          ),

          grist.docApi.fetchTable(
            TABLES.memberships
          ),

          grist.docApi.fetchTable(
            TABLES.posts
          ),

          grist.docApi.fetchTable(
            TABLES.comments
          ),

          grist.docApi.fetchTable(
            TABLES.users
          )

        ]
      );

    channels =
      rowsFromTable(
        channelsRaw
      );

    memberships =
      rowsFromTable(
        membershipsRaw
      );

    posts =
      rowsFromTable(
        postsRaw
      );

    comments =
      rowsFromTable(
        commentsRaw
      );

    users =
      rowsFromTable(
        usersRaw
      );

    if (
      !currentUserId ||
      !users.some(
        user =>
          Number(user.id) ===
          Number(currentUserId)
      )
    ) {

      const firstActive =
        users.find(
          user =>
            user.Actif !== false
        );

      currentUserId =
        firstActive
          ? firstActive.id
          : null;
    }

    if (previousChannelId) {

      currentChannel =
        channels.find(
          channel =>
            Number(channel.id) ===
            Number(previousChannelId)
        ) || null;

    }

    if (!currentChannel) {

      currentChannel =
        channels.find(
          channel =>
            String(
              channel.Nom
            )
              .toLowerCase() ===
            "général"
        ) ||
        channels[0] ||
        null;

    }

    renderCurrentUserSelector();

    renderChannels();

    renderFeed();

    updateComposerPermissions();

  } catch (error) {

    console.error(error);

    document.getElementById(
      "feed"
    ).innerHTML = `
      <div class="message error">

        <strong>
          Impossible de lire les données Grist.
        </strong>

        <br><br>

        ${escapeHtml(
          error.message ||
          error
        )}

      </div>
    `;
  }
}


/* ==========================================================
   EVENEMENTS GENERAUX
========================================================== */

document.getElementById(
  "new-post-button"
).addEventListener(
  "click",
  openComposer
);

document.getElementById(
  "close-composer"
).addEventListener(
  "click",
  closeComposer
);

document.getElementById(
  "cancel-post"
).addEventListener(
  "click",
  closeComposer
);

document.getElementById(
  "publish-post"
).addEventListener(
  "click",
  createPost
);

document.getElementById(
  "close-edit-modal"
).addEventListener(
  "click",
  closeEditModal
);

document.getElementById(
  "cancel-edit"
).addEventListener(
  "click",
  closeEditModal
);

document.getElementById(
  "save-edit"
).addEventListener(
  "click",
  saveEdit
);

document.querySelector(
  ".modal-backdrop"
).addEventListener(
  "click",
  closeEditModal
);


/* ==========================================================
   INIT
========================================================== */

initEditors();

loadData();
