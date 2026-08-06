import { decideCandidate, fetchCandidates } from "../api.js";

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

function listingBlock(side: { source: string; cid: string; title: string; maker?: string | null }) {
  return el("div", {}, [
    el("strong", { textContent: side.title }),
    el("div", { className: "muted", textContent: `${side.source} / ${side.cid}` }),
    side.maker ? el("div", { className: "muted", textContent: side.maker }) : document.createComment(""),
  ]);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function renderCandidates(root: HTMLElement): Promise<void> {
  root.replaceChildren(
    el("div", { className: "panel" }, [
      el("h2", { textContent: "候補キュー" }),
      el("p", {
        className: "muted",
        textContent: "dice ≥ 0.7 かつ正規化メーカー一致のペア。○で結合、×で別物確定。処理済みは再表示しません。",
      }),
    ]),
  );

  const statusRegion = el("div", {
    className: "status-region",
    role: "status",
    "aria-live": "polite",
    "aria-atomic": "true",
    "data-testid": "candidates-status",
  });
  const listHost = el("div", { "data-testid": "candidate-list" });
  root.append(statusRegion, listHost);

  let pending = false;

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

  function clearStatus(): void {
    statusRegion.textContent = "";
    statusRegion.className = "status-region";
    statusRegion.removeAttribute("data-kind");
    statusRegion.setAttribute("role", "status");
    statusRegion.setAttribute("aria-live", "polite");
  }

  async function load(): Promise<void> {
    listHost.replaceChildren(el("p", { className: "muted", textContent: "読み込み中…" }));
    try {
      const data = await fetchCandidates();
      listHost.replaceChildren();
      if (data.candidates.length === 0) {
        listHost.append(el("p", { className: "empty", textContent: "候補はありません。" }));
        return;
      }

      for (const candidate of data.candidates) {
        const card = el("article", {
          className: "candidate-card",
          "data-candidate-id": String(candidate.id),
        });
        card.append(
          el("div", { className: "muted", textContent: `dice ${candidate.dice.toFixed(3)}` }),
          el("div", { className: "candidate-pair" }, [
            listingBlock(candidate.a),
            listingBlock(candidate.b),
          ]),
        );
        const pairLabel = `${candidate.a.title}（${candidate.a.source} / ${candidate.a.cid}） と ${candidate.b.title}（${candidate.b.source} / ${candidate.b.cid}）`;
        const approve = el("button", {
          className: "primary",
          textContent: "○ 同一",
          "data-testid": `approve-${candidate.id}`,
          "aria-label": `○ 同一: ${pairLabel}`,
        });
        const reject = el("button", {
          className: "danger",
          textContent: "× 別物",
          "data-testid": `reject-${candidate.id}`,
          "aria-label": `× 別物: ${pairLabel}`,
        });

        const runDecision = async (same: boolean): Promise<void> => {
          if (pending) return;
          pending = true;
          approve.disabled = true;
          reject.disabled = true;
          clearStatus();
          try {
            await decideCandidate(candidate.id, same);
            setStatus(same ? "同一として結合しました。" : "別物として確定しました。", "success");
            await load();
          } catch (err) {
            setStatus(errorMessage(err), "error");
            approve.disabled = false;
            reject.disabled = false;
          } finally {
            pending = false;
          }
        };

        approve.addEventListener("click", () => {
          void runDecision(true);
        });
        reject.addEventListener("click", () => {
          void runDecision(false);
        });
        card.append(el("div", { className: "candidate-actions" }, [approve, reject]));
        listHost.append(card);
      }
    } catch (err) {
      listHost.replaceChildren();
      setStatus(errorMessage(err), "error");
    }
  }

  await load();
}
