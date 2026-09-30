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
  markup = markup.replace(
    /<div class="button-row">[\s\S]*?<\/div><p class="note">/,
    `<div class="button-row">${actionLink("button", actions.primary.href, actions.primary.label)}${actionLink("button light", actions.catalog.href, actions.catalog.label)}</div><p class="note">`,
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
