const path = require("path");
const visit = require("unist-util-visit");
const puppeteer = require("puppeteer");
const fs = require("fs").promises;
const Base64 = require("js-base64");

async function render(
  browser,
  definition,
  theme = "default",
  viewport,
  mermaidOptions
) {
  const page = await browser.newPage();
  page.setViewport(viewport);
  await page.goto(`file://${path.join(__dirname, "render.html")}`);
  await page.addScriptTag({
    path: require.resolve("mermaid/dist/mermaid.min.js"),
  });
  return await page.$eval(
    "#container",
    (container, definition, theme, mermaidOptions) => {
      container.innerHTML = `<div class="mermaid">${definition}</div>`;

      try {
        window.mermaid.initialize({
          ...mermaidOptions,
          theme,
        });
        window.mermaid.init();
        return container.querySelector(".mermaid").innerHTML;
      } catch (e) {
        return `${e}`;
      }
    },
    definition,
    theme,
    mermaidOptions
  );
}

function resolveNode(lang, expected = "mermaid") {
  if (!lang) {
    return;
  }
  const [language, options] = lang
    .split(":")
    .map((v) => v.trim().toLowerCase());
  if (language !== expected) {
    return;
  }
  if (options) {
    const optionsMap = options.split("&").reduce((a, c) => {
      const [k, v] = c.split("=").map((v) => v.trim());
      return { ...a, [k]: v };
    }, {});
    return optionsMap;
  }
  return {};
}

function mermaidNodes(markdownAST, expected = "mermaid") {
  const result = [];
  visit(markdownAST, "code", (node) => {
    const options = resolveNode(node.lang, expected);
    if (!options) {
      return;
    }
    node.options = options;
    result.push(node);
  });
  return result;
}

function generateImagTag(svgValue, options = {}) {
  const attrs = Object.entries(options).reduce(
    (a, [k, v]) => `${a} ${k}="${v}" data-${k}="${v}" `,
    ""
  );

  return `<img class="mermaid" src="data:image/svg+xml;base64,${Base64.encode(
    svgValue
  )}" ${attrs}/>`;
}

module.exports = async (
  { markdownAST },
  {
    language = "mermaid",
    theme = "default",
    viewport = { height: 200, width: 200 },
    mermaidOptions = { securityLevel: `loose` },
  }
) => {
  // Check if there is a match before launching anything
  let nodes = mermaidNodes(markdownAST, language);
  if (nodes.length === 0) {
    // No nodes to process
    return;
  }

  // Launch virtual browser
  let browser;
  try {
    browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    await Promise.all(
      nodes.map(async (node) => {
        node.type = "html";
        const svgValue = await render(browser, node.value, theme, viewport, {
          securityLevel: `loose`,
          flowchart: { htmlLabels: false },
        });
        node.value = generateImagTag(svgValue, node.options);
      })
    );
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};

// test the render function

if (process.argv[1] === __filename) {
  (async () => {
    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const theme = "default";
    const viewport = { width: 2000, height: 2000 };
    const mermaidOptions = {
      securityLevel: `loose`,
      flowchart: { htmlLabels: false },
    };
    const definition = `
    graph TD
      A[Christmas] -->|Get money| B(Go shopping)
      B --> C{Let me think}
      C -->|One| D[Laptop]
      C -->|Two| E[iPhone]
      C -->|Three| F[fa:fa-car Car]

    `;
    console.log(`definition:\n${definition}`);
    const svgValue = await render(
      browser,
      definition,
      theme,
      viewport,
      mermaidOptions
    );
    const options = resolveNode("mermaid:width=small&height=large");
    await fs.writeFile(
      "./result.html",
      generateImagTag(svgValue, options),
      "utf-8"
    );
    await fs.writeFile("./result.svg", svgValue, "utf-8");
    process.exit(0);
  })();
}
