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

  const listHost = el("div", { "data-testid": "candidate-list" });
  root.append(listHost);

  async function load(): Promise<void> {
    listHost.replaceChildren(el("p", { className: "muted", textContent: "読み込み中…" }));
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
      const approve = el("button", {
        className: "primary",
        textContent: "○ 同一",
        "data-testid": `approve-${candidate.id}`,
      });
      const reject = el("button", {
        className: "danger",
        textContent: "× 別物",
        "data-testid": `reject-${candidate.id}`,
      });
      approve.addEventListener("click", async () => {
        await decideCandidate(candidate.id, true);
        await load();
      });
      reject.addEventListener("click", async () => {
        await decideCandidate(candidate.id, false);
        await load();
      });
      card.append(el("div", { className: "candidate-actions" }, [approve, reject]));
      listHost.append(card);
    }
  }

  await load();
}
