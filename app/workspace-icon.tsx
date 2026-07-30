type IconName = "configuration" | "simulation" | "history" | "tests" | "documents" | "checklists" | "settings";

export function WorkspaceIcon({ name }: { name: IconName }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return <svg className="workspace-icon" viewBox="0 0 24 24" aria-hidden="true">
    {name === "configuration" && <><path {...common} d="M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4" /><circle {...common} cx="12" cy="12" r="2.5" /></>}
    {name === "simulation" && <><path {...common} d="M4 18V6m0 12h16" /><path {...common} d="M6.5 15.5l3.2-4 3 1.8 4.8-6.8" /><circle {...common} cx="17.5" cy="6.5" r="1.5" /></>}
    {name === "history" && <><path {...common} d="M4.8 9A7.5 7.5 0 1 1 6 16.5" /><path {...common} d="M4.8 4.8V9H9" /><path {...common} d="M12 7.5V12l3 2" /></>}
    {name === "tests" && <><path {...common} d="M9 3h6M10 3v5l-5 9.2A2.5 2.5 0 0 0 7.2 21h9.6a2.5 2.5 0 0 0 2.2-3.8L14 8V3" /><path {...common} d="M7.5 15h9" /></>}
    {name === "documents" && <><path {...common} d="M6 3h8l4 4v14H6z" /><path {...common} d="M14 3v5h4M9 12h6M9 16h6" /></>}
    {name === "checklists" && <><path {...common} d="M8 4h8M9 3h6v3H9zM6 5v16h12V5" /><path {...common} d="m8.5 11 1.4 1.4 2.6-3M13.5 11H16M8.5 16l1.4 1.4 2.6-3M13.5 16H16" /></>}
    {name === "settings" && <><path {...common} d="M9.7 3.5h4.6l.7 2.1c.5.2 1 .5 1.4.8l2.2-.5 2.3 4-1.5 1.6v1.6l1.5 1.6-2.3 4-2.2-.5c-.4.3-.9.6-1.4.8l-.7 2.1H9.7L9 19c-.5-.2-1-.5-1.4-.8l-2.2.5-2.3-4 1.5-1.6v-1.6L3.1 9.9l2.3-4 2.2.5c.4-.3.9-.6 1.4-.8z" /><circle {...common} cx="12" cy="12.3" r="3" /></>}
  </svg>;
}
