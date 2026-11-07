import { app } from "./$_app.ts";

import "../style.css";

export default app(function App(props) {
  return (
    <html lang="en" class="dark">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="description" content="Plan projects as an outline and export them as ASCII trees." />
        <title>ascii-tree planner</title>
      </head>
      <body>{props.children}</body>
    </html>
  );
});
