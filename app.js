(function () {
  "use strict";

  const STORAGE_KEY = "visual-markdown-editor-draft";
  const AUTOSAVE_DELAY = 500;
  const EMPTY_DOCUMENT = "";
  const UNTITLED_FILENAME = "Untitled markdown file";
  const PLACEHOLDER_MARKDOWN = `# Private Markdown editor

This is a simple Markdown editor for creating, reading, editing, and validating Markdown.

## Fully private by design

- Your document is stored locally in this browser.
- Nothing is sent to our servers.
- There is no tracking whatsoever.
- Your usage and Markdown content stay fully private.

## What you can do here

- Write Markdown visually or as source.
- Preview rendered Markdown before you use it elsewhere.
- Upload existing Markdown files.
- Copy or download your finished Markdown.

\`\`\`markdown
# Example

Write Markdown here, then preview or download it.
\`\`\``;

  let markdown = EMPTY_DOCUMENT;
  let lastFilename = "";
  let activeTab = "markdown";
  let editor = null;
  let viewer = null;
  let autosaveTimer = null;
  let toastTimer = null;
  let isSyncingEditor = false;
  let isShowingPlaceholder = false;

  const elements = {
    autosaveStatus: document.getElementById("autosaveStatus"),
    documentTitle: document.getElementById("documentTitle"),
    newButton: document.getElementById("newButton"),
    pasteButton: document.getElementById("pasteButton"),
    uploadButton: document.getElementById("uploadButton"),
    copyButton: document.getElementById("copyButton"),
    downloadButton: document.getElementById("downloadButton"),
    fileInput: document.getElementById("fileInput"),
    tabs: Array.from(document.querySelectorAll("[data-tab]")),
    panels: {
      visual: document.getElementById("visualPanel"),
      markdown: document.getElementById("markdownPanel"),
      preview: document.getElementById("previewPanel")
    },
    visualEditor: document.getElementById("visualEditor"),
    markdownSource: document.getElementById("markdownSource"),
    preview: document.getElementById("preview"),
    libraryError: document.getElementById("libraryError"),
    pasteModal: document.getElementById("pasteModal"),
    pasteInput: document.getElementById("pasteInput"),
    closePasteModal: document.getElementById("closePasteModal"),
    cancelPaste: document.getElementById("cancelPaste"),
    importPaste: document.getElementById("importPaste"),
    toast: document.getElementById("toast")
  };

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    if (window.lucide) {
      window.lucide.createIcons();
    }

    restoreDraft();
    isShowingPlaceholder = isEmptyMarkdown(markdown);
    bindEvents();

    if (!window.toastui || !window.toastui.Editor) {
      elements.libraryError.hidden = false;
      elements.visualEditor.hidden = true;
      syncAllViews();
      showToast("Editor library failed to load. Markdown and preview are still available.");
      return;
    }

    initializeToastEditor();
    syncAllViews();
    autosave(true);
  }

  function initializeToastEditor() {
    editor = new window.toastui.Editor({
      el: elements.visualEditor,
      height: "100%",
      initialEditType: "wysiwyg",
      previewStyle: "vertical",
      initialValue: getDisplayMarkdown(),
      usageStatistics: false,
      hideModeSwitch: true,
      toolbarItems: [
        ["heading", "bold", "italic", "strike"],
        ["hr", "quote"],
        ["ul", "ol", "task"],
        ["table", "link", "image"],
        ["code", "codeblock"]
      ]
    });

    editor.on("change", () => {
      if (isSyncingEditor || activeTab !== "visual") {
        return;
      }
      setMarkdown(editor.getMarkdown(), { source: "visual" });
    });

    viewer = window.toastui.Editor.factory({
      el: elements.preview,
      viewer: true,
      initialValue: getDisplayMarkdown(),
      usageStatistics: false
    });
  }

  function bindEvents() {
    elements.tabs.forEach((tab) => {
      tab.addEventListener("click", () => switchTab(tab.dataset.tab));
      tab.addEventListener("keydown", handleTabKeydown);
    });

    elements.markdownSource.addEventListener("input", () => {
      setMarkdown(elements.markdownSource.value, { source: "markdown" });
    });
    elements.markdownSource.addEventListener("paste", handleMarkdownPaste);
    elements.visualEditor.addEventListener("pointerdown", clearPlaceholderDocument);
    elements.visualEditor.addEventListener("keydown", clearPlaceholderDocument);
    elements.markdownSource.addEventListener("pointerdown", clearPlaceholderDocument);
    elements.markdownSource.addEventListener("keydown", clearPlaceholderDocument);
    elements.preview.addEventListener("pointerdown", clearPlaceholderDocument);
    elements.documentTitle.addEventListener("focus", handleDocumentTitleFocus);
    elements.documentTitle.addEventListener("blur", commitDocumentTitle);
    elements.documentTitle.addEventListener("keydown", handleDocumentTitleKeydown);

    elements.newButton.addEventListener("click", createNewDocument);
    elements.pasteButton.addEventListener("click", openPasteModal);
    elements.uploadButton.addEventListener("click", () => elements.fileInput.click());
    elements.fileInput.addEventListener("change", handleUpload);
    elements.copyButton.addEventListener("click", copyMarkdown);
    elements.downloadButton.addEventListener("click", downloadMarkdown);

    elements.closePasteModal.addEventListener("click", closePasteModal);
    elements.cancelPaste.addEventListener("click", closePasteModal);
    elements.importPaste.addEventListener("click", importPastedMarkdown);
    elements.pasteModal.addEventListener("click", (event) => {
      if (event.target === elements.pasteModal) {
        closePasteModal();
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !elements.pasteModal.hidden) {
        closePasteModal();
      }
    });
  }

  function switchTab(nextTab) {
    if (nextTab === activeTab) {
      return;
    }

    syncFromActiveView();
    activeTab = nextTab;
    elements.tabs.forEach((tab) => {
      const isActive = tab.dataset.tab === nextTab;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-selected", String(isActive));
      tab.tabIndex = isActive ? 0 : -1;
    });

    Object.entries(elements.panels).forEach(([name, panel]) => {
      const isActive = name === nextTab;
      panel.hidden = !isActive;
      panel.classList.toggle("is-active", isActive);
    });

    syncView(nextTab);
  }

  function handleTabKeydown(event) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }

    event.preventDefault();
    const currentIndex = elements.tabs.findIndex((tab) => tab.dataset.tab === activeTab);
    let nextIndex = currentIndex;

    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % elements.tabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + elements.tabs.length) % elements.tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = elements.tabs.length - 1;
    }

    elements.tabs[nextIndex].focus();
    switchTab(elements.tabs[nextIndex].dataset.tab);
  }

  function syncFromActiveView() {
    if (isShowingPlaceholder) {
      return;
    }

    if (activeTab === "visual" && editor) {
      setMarkdown(editor.getMarkdown(), { source: "visual", silent: true });
    }
    if (activeTab === "markdown") {
      setMarkdown(elements.markdownSource.value, { source: "markdown", silent: true });
    }
  }

  function syncAllViews() {
    syncView("markdown");
    syncView("visual");
    syncView("preview");
  }

  function syncView(viewName) {
    const displayMarkdown = getDisplayMarkdown();

    if (viewName === "markdown" && elements.markdownSource.value !== displayMarkdown) {
      elements.markdownSource.value = displayMarkdown;
    }

    if (viewName === "visual" && editor && editor.getMarkdown() !== displayMarkdown) {
      isSyncingEditor = true;
      editor.setMarkdown(displayMarkdown, false);
      editor.changeMode("wysiwyg", true);
      isSyncingEditor = false;
    }

    if (viewName === "preview") {
      renderPreview();
    }
  }

  function setMarkdown(nextMarkdown, options = {}) {
    if (markdown === nextMarkdown) {
      return;
    }

    markdown = nextMarkdown;
    isShowingPlaceholder = false;

    if (options.source !== "markdown") {
      elements.markdownSource.value = markdown;
    }

    if (options.source !== "visual" && editor) {
      isSyncingEditor = true;
      editor.setMarkdown(markdown, false);
      isSyncingEditor = false;
    }

    if (activeTab === "preview") {
      renderPreview();
    }

    if (!options.silent) {
      autosave();
    }
  }

  function handleMarkdownPaste(event) {
    const pastedText = event.clipboardData && event.clipboardData.getData("text/plain");
    const tableMarkdown = convertSpreadsheetTextToMarkdown(pastedText);

    if (!tableMarkdown) {
      return;
    }

    event.preventDefault();
    insertMarkdownIntoSource(tableMarkdown);
    showToast("Spreadsheet range converted to a Markdown table.");
  }

  function convertSpreadsheetTextToMarkdown(text) {
    if (!text || !text.includes("\t")) {
      return "";
    }

    const rows = text
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n")
      .split("\n")
      .map((row) => row.split("\t"))
      .filter((row) => row.some((cell) => cell.trim() !== ""));

    const columnCount = Math.max(...rows.map((row) => row.length));
    if (rows.length < 2 || columnCount < 2) {
      return "";
    }

    const normalizedRows = rows.map((row) => {
      const cells = row.slice(0, columnCount);
      while (cells.length < columnCount) {
        cells.push("");
      }
      return cells.map(formatTableCell);
    });

    const header = normalizedRows[0];
    const separator = Array.from({ length: columnCount }, () => "---");
    const body = normalizedRows.slice(1);

    return [header, separator, ...body]
      .map((row) => `| ${row.join(" | ")} |`)
      .join("\n");
  }

  function formatTableCell(cell) {
    return cell
      .trim()
      .replace(/\|/g, "\\|")
      .replace(/\n/g, "<br>");
  }

  function insertMarkdownIntoSource(markdownToInsert) {
    const source = elements.markdownSource;
    const start = source.selectionStart;
    const end = source.selectionEnd;
    const before = source.value.slice(0, start);
    const after = source.value.slice(end);
    const insertion = padMarkdownInsertion(before, markdownToInsert, after);
    const nextValue = `${before}${insertion}${after}`;
    const nextCursor = before.length + insertion.length;

    source.value = nextValue;
    source.selectionStart = nextCursor;
    source.selectionEnd = nextCursor;
    setMarkdown(nextValue, { source: "markdown" });
    autosave();
  }

  function padMarkdownInsertion(before, insertion, after) {
    const prefix = before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
    const suffix = after && !after.startsWith("\n\n") ? (after.startsWith("\n") ? "\n" : "\n\n") : "";
    return `${prefix}${insertion.trim()}\n${suffix}`;
  }

  function renderPreview() {
    if (viewer && typeof viewer.setMarkdown === "function") {
      viewer.setMarkdown(getDisplayMarkdown());
      window.requestAnimationFrame(decoratePreviewCodeBlocks);
      return;
    }

    elements.preview.textContent = getDisplayMarkdown() || "Nothing to preview yet.";
  }

  function decoratePreviewCodeBlocks() {
    elements.preview.querySelectorAll("pre").forEach((pre) => {
      if (pre.closest(".markdown-code-block")) {
        return;
      }

      const wrapper = document.createElement("div");
      wrapper.className = "markdown-code-block";

      const button = document.createElement("button");
      button.className = "code-copy-button";
      button.type = "button";
      button.setAttribute("aria-label", "Copy code");
      button.title = "Copy code";
      button.innerHTML = '<i data-lucide="copy" aria-hidden="true"></i>';
      button.addEventListener("click", () => copyCodeBlock(pre, button));

      pre.parentNode.insertBefore(wrapper, pre);
      wrapper.appendChild(pre);
      wrapper.appendChild(button);
    });

    if (window.lucide) {
      window.lucide.createIcons();
    }
  }

  async function copyCodeBlock(pre, button) {
    const code = pre.querySelector("code");
    const codeText = code ? code.textContent : pre.textContent;

    try {
      await navigator.clipboard.writeText(codeText);
      button.classList.add("is-copied");
      button.setAttribute("aria-label", "Code copied");
      button.title = "Code copied";
      button.innerHTML = '<i data-lucide="check" aria-hidden="true"></i>';
      if (window.lucide) {
        window.lucide.createIcons();
      }
      showToast("Code copied to clipboard.");

      window.setTimeout(() => {
        button.classList.remove("is-copied");
        button.setAttribute("aria-label", "Copy code");
        button.title = "Copy code";
        button.innerHTML = '<i data-lucide="copy" aria-hidden="true"></i>';
        if (window.lucide) {
          window.lucide.createIcons();
        }
      }, 1400);
    } catch (error) {
      showToast("Copy failed. Select the code block and copy it manually.");
    }
  }

  function createNewDocument() {
    syncFromActiveView();

    if (markdown.trim() && !window.confirm("Clear the current document and start a new one?")) {
      return;
    }

    lastFilename = "";
    syncDocumentTitle();
    isShowingPlaceholder = true;
    setMarkdown(EMPTY_DOCUMENT, { source: "new" });
    isShowingPlaceholder = true;
    syncAllViews();
    autosave();
    showToast("New blank document ready.");
  }

  function openPasteModal() {
    elements.pasteInput.value = "";
    elements.pasteModal.hidden = false;
    elements.pasteInput.focus();
  }

  function closePasteModal() {
    elements.pasteModal.hidden = true;
    elements.pasteButton.focus();
  }

  function importPastedMarkdown() {
    lastFilename = "";
    syncDocumentTitle();
    setMarkdown(elements.pasteInput.value, { source: "paste" });
    isShowingPlaceholder = isEmptyMarkdown(markdown);
    syncAllViews();
    closePasteModal();
    showToast("Markdown imported.");
  }

  function handleUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) {
      return;
    }

    const allowed = /\.(md|markdown|txt)$/i.test(file.name);
    if (!allowed) {
      showToast("Choose a .md, .markdown, or .txt file.");
      elements.fileInput.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      lastFilename = file.name;
      syncDocumentTitle();
      setMarkdown(String(reader.result || ""), { source: "upload" });
      isShowingPlaceholder = isEmptyMarkdown(markdown);
      syncAllViews();
      autosave();
      showToast(`Uploaded ${file.name}.`);
      elements.fileInput.value = "";
    };
    reader.onerror = () => {
      showToast("The file could not be read. Please try another Markdown file.");
      elements.fileInput.value = "";
    };
    reader.readAsText(file);
  }

  async function copyMarkdown() {
    syncFromActiveView();

    try {
      await navigator.clipboard.writeText(markdown);
      showToast("Markdown copied to clipboard.");
    } catch (error) {
      showToast("Copy failed. Select the Markdown tab and copy the text manually.");
    }
  }

  function downloadMarkdown() {
    syncFromActiveView();
    const filename = chooseDownloadFilename();
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast(`Downloaded ${filename}.`);
  }

  function chooseDownloadFilename() {
    const titleFilename = filenameFromDocumentTitle();
    if (titleFilename) {
      lastFilename = titleFilename;
      syncDocumentTitle();
      autosave();
      return titleFilename;
    }

    const heading = markdown.match(/^#\s+(.+)$/m);
    if (heading && heading[1]) {
      const slug = heading[1]
        .trim()
        .toLowerCase()
        .replace(/[`*_~[\]()#>!]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

      if (slug) {
        return `${slug}.md`;
      }
    }

    return "document.md";
  }

  function normalizeMarkdownFilename(filename) {
    const cleanFilename = filename.trim().replace(/[\\/:*?"<>|]/g, "-");
    if (!cleanFilename) {
      return "";
    }

    if (/\.(md|markdown|txt)$/i.test(cleanFilename)) {
      return cleanFilename.replace(/\.(markdown|txt)$/i, ".md");
    }

    return `${cleanFilename}.md`;
  }

  function handleDocumentTitleFocus() {
    if (!lastFilename) {
      elements.documentTitle.select();
    }
  }

  function handleDocumentTitleKeydown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      elements.documentTitle.blur();
    }

    if (event.key === "Escape") {
      event.preventDefault();
      syncDocumentTitle();
      elements.documentTitle.blur();
    }
  }

  function commitDocumentTitle() {
    const nextFilename = filenameFromDocumentTitle();
    lastFilename = nextFilename;
    syncDocumentTitle();
    autosave();
  }

  function filenameFromDocumentTitle() {
    const title = elements.documentTitle.value.trim();

    if (!title || title === UNTITLED_FILENAME) {
      return "";
    }

    return normalizeMarkdownFilename(title);
  }

  function syncDocumentTitle() {
    elements.documentTitle.value = lastFilename || UNTITLED_FILENAME;
  }

  function getDisplayMarkdown() {
    return isShowingPlaceholder ? PLACEHOLDER_MARKDOWN : markdown;
  }

  function isEmptyMarkdown(value) {
    return !value.trim();
  }

  function clearPlaceholderDocument() {
    if (!isShowingPlaceholder) {
      return;
    }

    isShowingPlaceholder = false;
    syncAllViews();
  }

  function autosave(immediate = false) {
    window.clearTimeout(autosaveTimer);

    const save = () => {
      const timestamp = new Date().toISOString();
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          markdown,
          lastFilename,
          updatedAt: timestamp
        })
      );
      elements.autosaveStatus.textContent = `Autosaved locally at ${formatTime(timestamp)}`;
    };

    if (immediate) {
      save();
      return;
    }

    autosaveTimer = window.setTimeout(save, AUTOSAVE_DELAY);
  }

  function restoreDraft() {
    try {
      const rawDraft = localStorage.getItem(STORAGE_KEY);
      if (!rawDraft) {
        return;
      }

      const draft = JSON.parse(rawDraft);
      markdown = typeof draft.markdown === "string" ? draft.markdown : EMPTY_DOCUMENT;
      lastFilename = typeof draft.lastFilename === "string" ? draft.lastFilename : "";
      syncDocumentTitle();

      if (draft.updatedAt) {
        elements.autosaveStatus.textContent = `Restored local draft from ${formatTime(draft.updatedAt)}`;
      }
    } catch (error) {
      elements.autosaveStatus.textContent = "Draft could not be restored";
    }
  }

  function formatTime(timestamp) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(timestamp));
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.hidden = false;
    toastTimer = window.setTimeout(() => {
      elements.toast.hidden = true;
    }, 3200);
  }
})();
