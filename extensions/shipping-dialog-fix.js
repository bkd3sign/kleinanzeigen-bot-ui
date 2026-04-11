/**
 * Kleinanzeigen Shipping Dialog Fix (for kleinanzeigen-bot)
 *
 * After Kleinanzeigen's 2026 site redesign, three things broke:
 *
 * 1. "Andere Versandmethoden" is no longer a <button> — the bot searches
 *    //button[contains(., "Andere Versandmethoden")] but the element is now
 *    a <div>, <a>, or <span>. Fix: Create a real <button> proxy that clicks
 *    the original element when activated.
 *
 * 2. Radio button IDs changed — bot expects id="radio-button-MEDIUM",
 *    site now uses dynamic IDs like ":r8rj:-control" with value="MEDIUM".
 *    Fix: Set the expected IDs on the radio inputs.
 *
 * 3. Carrier checkbox data-testid removed — bot expects
 *    input[data-testid~="Paket 5 kg"], site has no data-testid at all.
 *    Fix: Add data-testid from the label text.
 */

(function () {
  "use strict";

  const LOG = "[shipping-fix]";

  // ── Config ──────────────────────────────────────────────────────

  const SIZE_VALUES = ["SMALL", "MEDIUM", "LARGE"];

  const PACKAGE_LABELS = [
    "Paket 2 kg",
    "Päckchen",
    "S-Paket",
    "Paket 5 kg",
    "M-Paket",
    "Paket 10 kg",
    "Paket 20 kg",
    "Paket 31,5 kg",
    "L-Paket",
  ];

  // ── Fix 1: "Andere Versandmethoden" button proxy ───────────────

  function fixAndereVersandmethoden(dialog) {
    if (dialog.querySelector("[data-shipping-fix-proxy]")) return;

    // Find ANY element containing "Andere Versandmethoden" that is NOT a <button>
    const walker = document.createTreeWalker(dialog, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        // Skip our own injected elements
        if (node.hasAttribute("data-shipping-fix-proxy")) return NodeFilter.FILTER_REJECT;
        // Check if this element's direct text content contains the target
        const directText = Array.from(node.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent.trim())
          .join("");
        // Or the element's full text for leaf-level elements
        const fullText = node.textContent.trim();
        if (
          (directText.includes("Andere Versandmethoden") ||
            (fullText === "Andere Versandmethoden" && node.children.length === 0) ||
            (fullText.includes("Andere Versandmethoden") && node.childElementCount <= 1)) &&
          node.tagName !== "BUTTON" &&
          node.tagName !== "DIALOG" &&
          node.tagName !== "HEADER" &&
          node.tagName !== "MAIN" &&
          node.tagName !== "DIV" // skip generic containers, look for specific elements
        ) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      },
    });

    let targetElement = walker.nextNode();

    // If no specific element found, try broader search for clickable-looking elements
    if (!targetElement) {
      const allElements = dialog.querySelectorAll("a, span, p, label, [role='button'], [tabindex]");
      for (const el of allElements) {
        if (el.textContent.trim() === "Andere Versandmethoden" || el.textContent.trim().includes("Andere Versandmethoden")) {
          // Prefer the most specific (deepest) element
          if (!targetElement || targetElement.contains(el)) {
            targetElement = el;
          }
        }
      }
    }

    // Last resort: search ALL elements for exact text match
    if (!targetElement) {
      const allElements = dialog.querySelectorAll("*");
      for (const el of allElements) {
        const text = el.textContent.trim();
        if (text === "Andere Versandmethoden" && el.children.length === 0) {
          targetElement = el;
          break;
        }
      }
    }

    if (!targetElement) {
      // "Andere Versandmethoden" not found in this dialog state — might be on a different step
      return;
    }

    // Check if it's already a <button> — if so, no fix needed
    if (targetElement.tagName === "BUTTON") {
      console.log(LOG, '"Andere Versandmethoden" is already a <button>, no proxy needed');
      return;
    }

    // If the target's parent is a <button>, also no fix needed
    if (targetElement.closest("button")) {
      console.log(LOG, '"Andere Versandmethoden" is inside a <button>, no proxy needed');
      return;
    }

    console.log(LOG, `Found "Andere Versandmethoden" as <${targetElement.tagName.toLowerCase()}>, creating <button> proxy`);

    // Create a real <button> proxy that clicks the original element
    const proxy = document.createElement("button");
    proxy.textContent = "Andere Versandmethoden";
    proxy.setAttribute("data-shipping-fix-proxy", "true");
    proxy.setAttribute("type", "button");

    // Visually hidden but interactable via CDP (Chrome DevTools Protocol)
    Object.assign(proxy.style, {
      position: "absolute",
      width: "1px",
      height: "1px",
      overflow: "hidden",
      opacity: "0.01",
      pointerEvents: "all",
      bottom: "0",
      left: "0",
      padding: "0",
      border: "none",
      background: "transparent",
      zIndex: "1",
    });

    proxy.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log(LOG, 'Proxy <button> clicked, delegating to original element');
      targetElement.click();
    });

    dialog.appendChild(proxy);
    console.log(LOG, 'Injected <button> proxy for "Andere Versandmethoden"');
  }

  // ── Fix 2: Radio button IDs for size selection ─────────────────

  function fixRadioButtonIds(dialog) {
    for (const size of SIZE_VALUES) {
      const targetId = `radio-button-${size}`;
      if (dialog.querySelector(`#${CSS.escape(targetId)}`)) continue;

      const radio = dialog.querySelector(`input[type="radio"][value="${size}"]`);
      if (radio && radio.id !== targetId) {
        if (!radio.dataset.originalId) {
          radio.dataset.originalId = radio.id;
        }
        radio.id = targetId;
        console.log(LOG, `Set id="${targetId}" on radio (was "${radio.dataset.originalId}")`);
      }
    }
  }

  // ── Fix 3: Checkbox data-testid for carrier selection ──────────

  function fixCheckboxTestIds(dialog) {
    const checkboxes = dialog.querySelectorAll('input[type="checkbox"]');

    for (const checkbox of checkboxes) {
      const existing = checkbox.getAttribute("data-testid");
      if (existing && PACKAGE_LABELS.some((l) => existing.includes(l))) continue;

      // Find label via aria relationship or DOM proximity
      const container = checkbox.closest("[role='group'], [class*='relative']");
      if (!container) continue;

      const label = container.querySelector("label");
      if (!label) continue;

      const labelText = label.textContent.trim();

      for (const packageLabel of PACKAGE_LABELS) {
        if (labelText.includes(packageLabel)) {
          checkbox.setAttribute("data-testid", packageLabel);
          console.log(LOG, `Set data-testid="${packageLabel}" on checkbox (label: "${labelText}")`);
          break;
        }
      }
    }
  }

  // ── Main: Scan & patch dialogs ─────────────────────────────────

  function isShippingDialog(dialog) {
    const text = dialog.textContent || "";
    return (
      text.includes("Versandmethoden") ||
      text.includes("Paketgröße") ||
      text.includes("Versandoptionen") ||
      text.includes("DHL") ||
      text.includes("Hermes")
    );
  }

  function patchDialogs() {
    const dialogs = document.querySelectorAll("dialog[open]");
    for (const dialog of dialogs) {
      if (!isShippingDialog(dialog)) continue;
      fixAndereVersandmethoden(dialog);
      fixRadioButtonIds(dialog);
      fixCheckboxTestIds(dialog);
    }
  }

  // Wait for document.body to exist, then start observing
  function init() {
    patchDialogs();

    let patchTimeout;
    const observer = new MutationObserver(() => {
      clearTimeout(patchTimeout);
      patchTimeout = setTimeout(patchDialogs, 30);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open", "class"],
    });

    console.log(LOG, "Extension loaded — watching for shipping dialogs");
  }

  if (document.body) {
    init();
  } else {
    // addScriptToEvaluateOnNewDocument runs before body exists
    document.addEventListener("DOMContentLoaded", init);
  }
})();
