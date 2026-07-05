type UiExperiment = {
  name: string;
  description: string;
  path: string;
  status: string;
};

const UI_EXPERIMENTS: UiExperiment[] = [
  {
    name: "Canvas UI",
    description: "The current board renderer and controls.",
    path: "canvas",
    status: "Current",
  },
  {
    name: "Three.js GPU UI",
    description: "A GPU-rendered clone of the board canvas without the toolbar.",
    path: "three",
    status: "Experiment",
  },
];

function getExperimentHref(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${base}/${path}`;
}

export function DevUiPicker(): JSX.Element {
  return (
    <main className="min-h-screen bg-[#121212] px-5 py-8 font-ui text-[#f6ead7] [color-scheme:dark]">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header className="border-b border-[#3b3328] pb-5">
          <p className="text-sm font-bold uppercase tracking-[0.18em] text-[#e8b86b]">FF Solitaire</p>
          <h1 className="mt-2 text-3xl font-black sm:text-4xl">Choose a UI</h1>
        </header>

        <section className="grid gap-3" aria-label="Available UI experiments">
          {UI_EXPERIMENTS.map((experiment) => (
            <a
              key={experiment.path}
              href={getExperimentHref(experiment.path)}
              className="group grid gap-2 rounded-lg border border-[#4a3f31] bg-[#1d1a17] p-4 text-inherit no-underline transition hover:border-[#e8b86b] hover:bg-[#282219] focus:outline-none focus:ring-2 focus:ring-[#e8b86b]"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-black">{experiment.name}</h2>
                <span className="rounded-full border border-[#8b6f43] px-2.5 py-1 text-xs font-bold uppercase text-[#ffd99b]">
                  {experiment.status}
                </span>
              </div>
              <p className="max-w-prose text-sm leading-6 text-[#d7c6ad]">{experiment.description}</p>
            </a>
          ))}
        </section>
      </div>
    </main>
  );
}
