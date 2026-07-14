export const htmlTemplate = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>$if(title)$$title$$else$Document$endif$</title>
  <style>
    $styles.html()$
  </style>
$for(css)$
  <link rel="stylesheet" href="$css$">
$endfor$
</head>
<body>
  <main class="markdown-body">
$body$
  </main>
</body>
</html>
`;
