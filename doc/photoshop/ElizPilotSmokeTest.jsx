#target photoshop
/*
  Smoke-тест частотки без экшена Лизы (8-bit JPEG).
*/

(function () {
  var PREVIEW =
    "/Users/maxim/MP_Eingener/pixmuse/doc/previews/TSV_0035.jpg";

  var f = new File(PREVIEW);
  if (!f.exists) {
    alert("Нет файла:\n" + PREVIEW);
    return;
  }

  while (app.documents.length) {
    app.activeDocument.close(SaveOptions.DONOTSAVECHANGES);
  }

  open(f);
  var doc = app.activeDocument;
  if (doc.activeLayer.isBackgroundLayer) {
    doc.activeLayer.duplicate();
  }
  doc.activeLayer.name = "test merged";
  var active = doc.activeLayer;
  for (var j = doc.layers.length - 1; j >= 0; j--) {
    if (doc.layers[j] !== active) {
      doc.layers[j].remove();
    }
  }

  alert(
    "Превью открыто, один слой «test merged».\n\n" +
      "Файл → Сценарии → ElizFrequencySetup.jsx\n\n" +
      "Тест 2: «частотка» on/off vs «исходник (сравнение)»."
  );
})();
