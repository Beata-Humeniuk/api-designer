#!/usr/bin/env bash
#
# Is a candidate free in the Visual Studio Marketplace?
#
# The Marketplace guards TWO fields independently, and refuses a publish on
# either — as this repository learned twice in a row:
#
#   name         → "The extension '<name>' already exists in the Marketplace."
#   displayName  → "This extension display name is taken."
#
# Both refusals arrive only after a full build, so ask the gallery first. The
# gallery answers without a token.
#
# Usage: check-marketplace-name.sh <name> [displayName]
#   scripts/check-marketplace-name.sh api-editor "API Editor"
#
# Exit code 0 = both free, 1 = something is taken, 2 = could not ask.

set -uo pipefail

NAME="${1:-}"
DISPLAY="${2:-}"
if [ -z "$NAME" ]; then
  echo "usage: $0 <name> [displayName]" >&2
  exit 2
fi

# One gallery search, restricted to VS Code extensions. The search is fuzzy,
# so the caller compares exactly; this only widens the net.
query() {
  curl -sS --max-time 40 -X POST \
    'https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery' \
    -H 'Content-Type: application/json' \
    -H 'Accept: application/json;api-version=3.0-preview.1' \
    -d "{\"filters\":[{\"criteria\":[{\"filterType\":8,\"value\":\"Microsoft.VisualStudio.Code\"},{\"filterType\":10,\"value\":$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1")}],\"pageSize\":500}],\"flags\":914}"
}

report() { # <field> <wanted> <json>
  FIELD="$1" WANTED="$2" node -e '
    let raw = "";
    process.stdin.on("data", (c) => { raw += c; });
    process.stdin.on("end", () => {
      const field = process.env.FIELD;
      const wanted = process.env.WANTED.trim().toLowerCase();
      let list = [];
      try { list = JSON.parse(raw).results[0].extensions; } catch (e) {
        console.log("  ? nie udalo sie odpytac galerii");
        process.exit(2);
      }
      const key = field === "name" ? "extensionName" : "displayName";
      const hits = list.filter((x) => String(x[key] || "").trim().toLowerCase() === wanted);
      if (!hits.length) {
        console.log("  OK  " + field + ": \"" + process.env.WANTED + "\" — wolne (przeszukano " + list.length + " rozszerzen VS Code)");
        process.exit(0);
      }
      for (const h of hits) {
        console.log("  ZAJETE  " + field + ": \"" + process.env.WANTED + "\" — " +
          h.publisher.publisherName + "." + h.extensionName +
          " (\"" + h.displayName + "\", od " + String(h.publishedDate || "?").slice(0, 10) + ")");
      }
      process.exit(1);
    });
  '
}

status=0
echo "Marketplace — sprawdzenie kandydata:"
report name "$NAME" <<< "$(query "$NAME")" || status=1
if [ -n "$DISPLAY" ]; then
  report displayName "$DISPLAY" <<< "$(query "$DISPLAY")" || status=1
fi

echo
if [ "$status" = 0 ]; then
  echo "Oba czlony wolne. Uwaga: brak w wyszukiwarce to mocna przeslanka, nie dowod —"
  echo "galeria nie pokazuje rozszerzen wycofanych ani nieopublikowanych."
else
  echo "Cos jest zajete — publikacja odbije sie po pelnym buildzie. Wybierz inaczej."
fi
exit "$status"
