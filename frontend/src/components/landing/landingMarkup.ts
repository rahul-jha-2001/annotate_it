import source from "./landingPageSource.html?raw";
import type { LandingActions } from "./landingActions";

export type LandingTask = "audio" | "image" | "classification";

const tasks: LandingTask[] = ["audio", "image", "classification"];
const taskCopy: Record<LandingTask, [string, string, string]> = {
  audio: ["Mark the speaker turn", "Drag across the waveform to mark the start and end of a turn.", "Speaker turn"],
  image: ["Box the object", "Draw a bounding box around the object in this frame.", "Vehicle"],
  classification: ["Select the category", "Choose the label that best describes this clip.", "Overlapping speakers"],
};

const bodyMatch = source.match(/<body>([\s\S]*?)<script>/);
if (!bodyMatch) throw new Error("Landing page source is missing its body content");
const body = bodyMatch[1].trim();

const actionLink = (className: string, href: string, label: string) =>
  `<a class="${className}" href="${href}">${label}</a>`;

export function buildLandingMarkup(actions: LandingActions, task: LandingTask): string {
  let markup = body;
  markup = markup.replace(
    `<a class="nav-action" href="#overview">View example</a>`,
    `<a href="${actions.catalog.href}">Catalog</a><a href="#overview">View example</a>${actionLink("nav-action", actions.account.href, actions.account.label)}`,
  );
  markup = markup.replace("<span>Gold accuracy</span></div><div><b>0.94</b><span>Agreement</span>", "<span>87% gold accuracy · n=4 gold items</span></div><div><b>0.94</b><span>0.94 agreement · n=3 annotators</span>");
  markup = markup.replace("<section class=\"closing shell\">", `<section class="section shell" id="export"><div class="section-heading"><h2>Export the evidence behind every label.</h2><p>Illustrative provenance shown for one experiment snapshot.</p></div><div class="fig-frame"><div class="fig-body"><strong>RAW ARCHIVE → CONSENSUS DATASET</strong><p>SOURCE ANNOTATIONS · 18 records &nbsp; SOURCE CUTOFF · 2026-10-01 18:00 UTC</p><p>WEIGHTS · reliability-adjusted &nbsp; CONFIGURATION VERSION · config-v4</p><p>ALGORITHM VERSION · consensus-v1 &nbsp; CODE VERSION · app-2026.10.1</p><p>CONFIDENCE · local to this experiment &nbsp; WARNINGS · 2 items need review</p><p>SNAPSHOT CHECKSUM · sha256:8f3c…d91a</p></div></div></section><section class="closing shell">`);
  markup = markup.replace(
    /<div class="button-row">[\s\S]*?<\/div><p class="note">/,
    `<div class="button-row">${actionLink("button", actions.catalog.href, actions.catalog.label)}${actionLink("button light", actions.primary.href, actions.primary.label)}</div><p class="note">`,
  );
  markup = markup.replace(
    `<a class="button" href="#setup">Explore the workflow</a></section>`,
    `${actionLink("button", actions.primary.href, actions.primary.label)}</section>`,
  );

  for (const candidate of tasks) {
    const selected = candidate === task;
    const tabPattern = new RegExp(`<button role="tab"[^>]*id="tab-${candidate}"[^>]*data-task="${candidate}">`);
    markup = markup.replace(
      tabPattern,
      `<button role="tab" aria-controls="annotation-panel" id="tab-${candidate}" data-task="${candidate}" aria-selected="${selected}" tabindex="${selected ? 0 : -1}">`,
    );
  }

  markup = markup
    .replace(/aria-labelledby="tab-(audio|image|classification)"/, `aria-labelledby="tab-${task}"`)
    .replace(/data-task="(audio|image|classification)" id="annotation-stage"/, `data-task="${task}" id="annotation-stage"`)
    .replace(/<h3 id="task-instruction">[^<]*<\/h3>/, `<h3 id="task-instruction">${taskCopy[task][0]}</h3>`)
    .replace(/<p id="task-help">[^<]*<\/p>/, `<p id="task-help">${taskCopy[task][1]}</p>`)
    .replace(/<span id="task-label">[^<]*<\/span>/, `<span id="task-label">${taskCopy[task][2]}</span>`);

  return markup;
}
