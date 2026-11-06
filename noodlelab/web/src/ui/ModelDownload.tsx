// "Download TypeDB model": the demonstrator's whole model (schema with functions, data, and a README with loading
// instructions) as a ZIP, exported by the API from the live database at the moment of the click.

import { useState } from "react";
import { API } from "../semantic/api";

export function ModelDownload() {
  const [state, setState] = useState<"idle" | "busy" | "failed">("idle");
  const download = async () => {
    setState("busy");
    try {
      const response = await fetch(`${API}/export/model.zip`);
      if (!response.ok) throw new Error(String(response.status));
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "noodlelab-vehicle-typedb-model.zip";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setState("idle");
    } catch {
      setState("failed");
    }
  };
  return (
    <div className="model-download">
      {state === "failed" && <span className="model-download-error" role="status">The export needs TypeDB, which did not answer. Try again.</span>}
      <button type="button" onClick={download} disabled={state === "busy"}
        title="The schema (with functions), the full dataset and a README for loading it into your own TypeDB 3.14">
        <span className="icon-download" aria-hidden />{state === "busy" ? "Exporting…" : "Download TypeDB model"}
      </button>
    </div>
  );
}
