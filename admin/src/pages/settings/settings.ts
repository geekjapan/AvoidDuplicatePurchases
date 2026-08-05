function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "className") node.className = value;
    else if (key === "textContent") node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    node.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return node;
}

interface AdminSettings {
  port: number;
  exportDestination: string;
}

async function fetchSettings(): Promise<AdminSettings> {
  const res = await fetch("/api/settings");
  const text = await res.text();
  if (!res.ok) throw new Error(`設定の取得に失敗しました: ${text}`);
  return JSON.parse(text) as AdminSettings;
}

async function saveSettings(settings: AdminSettings): Promise<AdminSettings> {
  const res = await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`設定の保存に失敗しました: ${text}`);
  return JSON.parse(text) as AdminSettings;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function renderSettings(root: HTMLElement): Promise<void> {
  root.replaceChildren(
    el("div", { className: "panel" }, [
      el("h2", { textContent: "設定" }),
      el("p", {
        className: "muted",
        textContent: "サーバポートとエクスポート先フォルダを設定します。",
      }),
    ]),
  );

  const form = el("form", { className: "settings-form", "data-testid": "settings-form" });

  const portLabel = el("label", { for: "settings-port", textContent: "ポート (1–65535)" });
  const portInput = el("input", {
    id: "settings-port",
    type: "number",
    min: "1",
    max: "65535",
    step: "1",
    "data-testid": "settings-port",
    "aria-label": "ポート",
    required: "true",
  });

  const destLabel = el("label", {
    for: "settings-export-destination",
    textContent: "エクスポート先（絶対パス）",
  });
  const destInput = el("input", {
    id: "settings-export-destination",
    type: "text",
    placeholder: "/Users/you/Drive/adp-export",
    "data-testid": "settings-export-destination",
    "aria-label": "エクスポート先",
    required: "true",
  });

  const saveBtn = el("button", {
    type: "submit",
    className: "primary",
    textContent: "保存",
    "data-testid": "settings-save",
    "aria-label": "設定を保存",
  });

  form.append(portLabel, portInput, destLabel, destInput, saveBtn);

  const statusRegion = el("div", {
    className: "status-region",
    role: "status",
    "aria-live": "polite",
    "aria-atomic": "true",
    "data-testid": "settings-status",
  });

  root.append(form, statusRegion);

  let pending = false;

  function setPending(value: boolean): void {
    pending = value;
    saveBtn.disabled = value;
    portInput.disabled = value;
    destInput.disabled = value;
  }

  function setStatus(message: string, kind: "info" | "success" | "error" = "info"): void {
    statusRegion.textContent = message;
    statusRegion.className = `status-region status-${kind}`;
    statusRegion.setAttribute("data-kind", kind);
    if (kind === "error") {
      statusRegion.setAttribute("role", "alert");
      statusRegion.setAttribute("aria-live", "assertive");
    } else {
      statusRegion.setAttribute("role", "status");
      statusRegion.setAttribute("aria-live", "polite");
    }
  }

  async function load(): Promise<void> {
    setPending(true);
    setStatus("設定を読み込み中…");
    try {
      const settings = await fetchSettings();
      portInput.value = String(settings.port);
      destInput.value = settings.exportDestination;
      setStatus("設定を読み込みました", "success");
    } catch (err) {
      setStatus(errorMessage(err), "error");
    } finally {
      setPending(false);
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void (async () => {
      if (pending) return;
      const port = Number(portInput.value);
      const exportDestination = destInput.value.trim();
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        setStatus("ポートは 1 から 65535 の整数で指定してください", "error");
        return;
      }
      if (!exportDestination.startsWith("/")) {
        setStatus("エクスポート先は絶対パスで指定してください", "error");
        return;
      }
      setPending(true);
      setStatus("保存中…");
      try {
        const saved = await saveSettings({ port, exportDestination });
        portInput.value = String(saved.port);
        destInput.value = saved.exportDestination;
        setStatus("設定を保存しました", "success");
      } catch (err) {
        setStatus(errorMessage(err), "error");
      } finally {
        setPending(false);
      }
    })();
  });

  await load();
}
