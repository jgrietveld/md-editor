(function () {
  "use strict";

  const STORAGE_KEY = "visual-markdown-editor-draft";
  const AUTOSAVE_DELAY = 500;
  const EMPTY_DOCUMENT = "";

  let markdown = EMPTY_DOCUMENT;
  let lastFilename = "";
  let activeTab = "visual";
  let editor = null;
  let viewer = null;
  let fallbackVisual = null;
  let autosaveTimer = null;
  let toastTimer = null;
  let isSyncingEditor = false;

  const elements = {
    autosaveStatus: document.getElementById("autosaveStatus"),
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
    restoreDraft();
    bindEvents();

    try {
      if (!window.toastui || !window.toastui.Editor) {
        throw new Error("TOAST UI Editor is unavailable.");
      }
      initializeToastEditor();
    } catch (error) {
      initializeFallbackEditor();
      elements.libraryError.hidden = false;
      showToast("Visual editor fallback loaded because TOAST UI is unavailable.");
    }

    syncAllViews();
    autosave(true);
  }

  function initializeToastEditor() {
    editor = new window.toastui.Editor({
      el: elements.visualEditor,
      height: "100%",
      initialEditType: "wysiwyg",
      previewStyle: "vertical",
      initialValue: markdown,
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
      initialValue: markdown,
      usageStatistics: false
    });
  }

  function initializeFallbackEditor() {
    elements.visualEditor.innerHTML = "";
    fallbackVisual = document.createElement("div");
    fallbackVisual.className = "fallback-visual-editor markdown-body";
    fallbackVisual.contentEditable = "true";
    fallbackVisual.setAttribute("role", "textbox");
    fallbackVisual.setAttribute("aria-label", "Visual Markdown editor fallback");
    fallbackVisual.spellcheck = true;
    fallbackVisual.addEventListener("input", () => {
      if (activeTab === "visual") {
        setMarkdown(fallbackVisual.innerText, { source: "fallback-visual" });
      }
    });
    elements.visualEditor.appendChild(fallbackVisual);
  }

  function bindEvents() {
    elements.tabs.forEach((tab) => {
      tab.addEventListener("click", () => switchTab(tab.dataset.tab));
      tab.addEventListener("keydown", handleTabKeydown);
    });

    elements.markdownSource.addEventListener("input", () => {
      setMarkdown(elements.markdownSource.value, { source: "markdown" });
    });
    elements.markdownSource.addEventListener("paste", handleSpreadsheetPaste);
    elements.panels.visual.addEventListener("paste", handleSpreadsheetPaste, true);

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
    if (viewName === "markdown" && elements.markdownSource.value !== markdown) {
      elements.markdownSource.value = markdown;
    }

    if (viewName === "visual" && editor && editor.getMarkdown() !== markdown) {
      isSyncingEditor = true;
      editor.setMarkdown(markdown, false);
      editor.changeMode("wysiwyg", true);
      isSyncingEditor = false;
    }

    if (viewName === "visual" && fallbackVisual && document.activeElement !== fallbackVisual) {
      fallbackVisual.innerHTML = renderBasicMarkdown(markdown || "");
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

    if (options.source !== "markdown") {
      elements.markdownSource.value = markdown;
    }

    if (options.source !== "visual" && editor) {
      isSyncingEditor = true;
      editor.setMarkdown(markdown, false);
      isSyncingEditor = false;
    }

    if (options.source !== "fallback-visual" && fallbackVisual && document.activeElement !== fallbackVisual) {
      fallbackVisual.innerHTML = renderBasicMarkdown(markdown || "");
    }

    if (activeTab === "preview") {
      renderPreview();
    }

    if (!options.silent) {
      autosave();
    }
  }

  function handleSpreadsheetPaste(event) {
    const clipboard = event.clipboardData;
    const pastedText = clipboard && clipboard.getData("text/plain");
    const pastedHtml = clipboard && clipboard.getData("text/html");
    const tableMarkdown = convertSpreadsheetTextToMarkdown(pastedText);

    if (!tableMarkdown) {
      return;
    }

    if (activeTab === "markdown" || event.target === elements.markdownSource) {
      event.preventDefault();
      event.stopPropagation();
      insertMarkdownIntoSource(tableMarkdown);
      showToast("Spreadsheet range converted to a Markdown table.");
      return;
    }

    if (pastedHtml && /<table[\s>]/i.test(pastedHtml)) {
      window.setTimeout(() => {
        if (editor) {
          setMarkdown(editor.getMarkdown(), { source: "visual" });
          autosave();
          showToast("Spreadsheet range pasted as a table.");
        }
      }, 80);
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    insertMarkdownIntoVisualEditor(tableMarkdown);
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

    if (rows.length < 2 || Math.max(...rows.map((row) => row.length)) < 2) {
      return "";
    }

    const columnCount = Math.max(...rows.map((row) => row.length));
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
    const tableRows = [header, separator, ...body].map((row) => `| ${row.join(" | ")} |`);

    return `\n${tableRows.join("\n")}\n`;
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

  function insertMarkdownIntoVisualEditor(markdownToInsert) {
    if (editor && typeof editor.insertText === "function") {
      editor.insertText(markdownToInsert);
      setMarkdown(editor.getMarkdown(), { source: "visual" });
      return;
    }

    if (editor && typeof editor.exec === "function") {
      try {
        editor.exec("addTable", parseMarkdownTableForEditor(markdownToInsert));
        setMarkdown(editor.getMarkdown(), { source: "visual" });
        return;
      } catch (error) {
        // Fall through to canonical Markdown insertion below.
      }
    }

    const insertion = padMarkdownInsertion(markdown, markdownToInsert, "");
    setMarkdown(`${markdown}${insertion}`, { source: "visual" });
    syncView("visual");
  }

  function parseMarkdownTableForEditor(tableMarkdown) {
    const rows = tableMarkdown
      .trim()
      .split("\n")
      .filter((row) => !/^\|\s*-/.test(row))
      .map((row) => row.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()));

    return {
      heading: rows[0] || [],
      body: rows.slice(1)
    };
  }

  function padMarkdownInsertion(before, insertion, after) {
    const prefix = before && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : "";
    const suffix = after && !after.startsWith("\n\n") ? (after.startsWith("\n") ? "\n" : "\n\n") : "";
    return `${prefix}${insertion.trim()}\n${suffix}`;
  }

  function renderPreview() {
    if (viewer && typeof viewer.setMarkdown === "function") {
      viewer.setMarkdown(markdown);
      return;
    }

    elements.preview.innerHTML = renderBasicMarkdown(markdown || "Nothing to preview yet.");
  }

  function renderBasicMarkdown(source) {
    const lines = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const html = [];
    let index = 0;

    while (index < lines.length) {
      const line = lines[index];

      if (!line.trim()) {
        index += 1;
        continue;
      }

      if (/^```/.test(line)) {
        const code = [];
        index += 1;
        while (index < lines.length && !/^```/.test(lines[index])) {
          code.push(lines[index]);
          index += 1;
        }
        index += 1;
        html.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
        continue;
      }

      if (isMarkdownTableStart(lines, index)) {
        const tableRows = [];
        while (index < lines.length && /^\s*\|.*\|\s*$/.test(lines[index])) {
          tableRows.push(lines[index]);
          index += 1;
        }
        html.push(renderBasicTable(tableRows));
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        const level = heading[1].length;
        html.push(`<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>`);
        index += 1;
        continue;
      }

      if (/^>\s?/.test(line)) {
        const quote = [];
        while (index < lines.length && /^>\s?/.test(lines[index])) {
          quote.push(lines[index].replace(/^>\s?/, ""));
          index += 1;
        }
        html.push(`<blockquote>${quote.map(renderInlineMarkdown).join("<br>")}</blockquote>`);
        continue;
      }

      if (/^\s*[-*+]\s+/.test(line)) {
        const items = [];
        while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index])) {
          items.push(lines[index].replace(/^\s*[-*+]\s+/, ""));
          index += 1;
        }
        html.push(`<ul>${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ul>`);
        continue;
      }

      if (/^\s*\d+\.\s+/.test(line)) {
        const items = [];
        while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
          items.push(lines[index].replace(/^\s*\d+\.\s+/, ""));
          index += 1;
        }
        html.push(`<ol>${items.map((item) => `<li>${renderInlineMarkdown(item)}</li>`).join("")}</ol>`);
        continue;
      }

      const paragraph = [];
      while (index < lines.length && lines[index].trim()) {
        paragraph.push(lines[index]);
        index += 1;
      }
      html.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
    }

    return html.join("");
  }

  function isMarkdownTableStart(lines, index) {
    return Boolean(
      lines[index] &&
        lines[index + 1] &&
        /^\s*\|.*\|\s*$/.test(lines[index]) &&
        /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])
    );
  }

  function renderBasicTable(rows) {
    const parsed = rows.map((row) =>
      row
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => renderInlineMarkdown(cell.trim()))
    );
    const header = parsed[0] || [];
    const body = parsed.slice(2);

    return `<table><thead><tr>${header.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead><tbody>${body
      .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
      .join("")}</tbody></table>`;
  }

  function renderInlineMarkdown(text) {
    return escapeHtml(text)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/~~([^~]+)~~/g, "<del>$1</del>");
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function createNewDocument() {
    syncFromActiveView();

    if (markdown.trim() && !window.confirm("Clear the current document and start a new one?")) {
      return;
    }

    lastFilename = "";
    setMarkdown(EMPTY_DOCUMENT, { source: "new" });
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
    setMarkdown(elements.pasteInput.value, { source: "paste" });
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
      setMarkdown(String(reader.result || ""), { source: "upload" });
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
    if (lastFilename && /\.(md|markdown|txt)$/i.test(lastFilename)) {
      return normalizeMarkdownFilename(lastFilename);
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
    return filename.replace(/\.(markdown|txt)$/i, ".md");
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
      elements.autosaveStatus.textContent = `Autosaved ${formatTime(timestamp)}`;
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

      if (draft.updatedAt) {
        elements.autosaveStatus.textContent = `Restored ${formatTime(draft.updatedAt)}`;
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
