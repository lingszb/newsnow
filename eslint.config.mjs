import { ourongxing, react } from "@ourongxing/eslint-config"

const renamedReactRules = {
  "react-dom/no-children-in-void-dom-elements": "react-dom/no-void-elements-with-children",
  "react/ensure-forward-ref-using-ref": "react/no-useless-forward-ref",
  "react/no-comment-textnodes": "react/jsx-no-comment-textnodes",
  "react/no-nested-components": "react/no-nested-component-definitions",
  "react/prefer-shorthand-boolean": "react/jsx-shorthand-boolean",
  "react/prefer-shorthand-fragment": "react/jsx-shorthand-fragment",
}

const reactConfig = (await react({
  files: ["src/**"],
  tsconfigPath: "tsconfig.app.json",
})).map((config) => {
  const rules = { ...config.rules }
  for (const [oldName, currentName] of Object.entries(renamedReactRules)) {
    if (!(oldName in rules)) continue
    rules[currentName] = rules[oldName]
    delete rules[oldName]
  }
  return { ...config, rules }
})

export default ourongxing({
  type: "app",
  // 貌似不能 ./ 开头，
  ignores: ["src/routeTree.gen.ts", "imports.app.d.ts", "public/", ".vscode", "**/*.json"],
}).append(reactConfig)
