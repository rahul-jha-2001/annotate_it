import { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from "react";

import { landingActions } from "./landingActions";
import { buildLandingMarkup, type LandingTask } from "./landingMarkup";
import "./landing.css";

const tasks: LandingTask[] = ["audio", "image", "classification"];

export default function LandingPage({ isSignedIn }: { isSignedIn: boolean }) {
  const [task, setTask] = useState<LandingTask>("audio");
  const markup = useMemo(() => buildLandingMarkup(landingActions(isSignedIn), task), [isSignedIn, task]);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = "TaskGlass — Run annotation experiments from one place";
    return () => { document.title = previousTitle; };
  }, []);

  const selectTask = (next: LandingTask, focus = false) => {
    setTask(next);
    if (focus) requestAnimationFrame(() => document.getElementById("tab-" + next)?.focus());
  };

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const tab = target.closest<HTMLElement>("[role=tab][data-task]");
    if (tab?.dataset.task && tasks.includes(tab.dataset.task as LandingTask)) {
      event.preventDefault();
      selectTask(tab.dataset.task as LandingTask);
      return;
    }
    const anchor = target.closest<HTMLAnchorElement>("a[href^=\"#\"]");
    if (!anchor) return;
    event.preventDefault();
    document.querySelector(anchor.getAttribute("href")!)?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.getAttribute("role") !== "tab" || !target.dataset.task) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const current = tasks.indexOf(target.dataset.task as LandingTask);
    const offset = event.key === "ArrowRight" ? 1 : -1;
    selectTask(tasks[(current + offset + tasks.length) % tasks.length], true);
  };

  return <div
    className="landing-page"
    onClick={onClick}
    onKeyDown={onKeyDown}
    dangerouslySetInnerHTML={{ __html: markup }}
  />;
}
