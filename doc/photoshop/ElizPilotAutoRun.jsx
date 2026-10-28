#target photoshop
/*
  Автопрогон без alert: smoke + частотка + отчёт в /tmp/eliz_pilot_result.txt
*/

(function () {
  var PREVIEW =
    "/Users/maxim/MP_Eingener/pixmuse/doc/previews/TSV_0035.jpg";
  var FREQ = new File(
    "/Users/maxim/MP_Eingener/pixmuse/doc/photoshop/ElizFrequencySetup.jsx"
  );
  var OUT = new File("/tmp/eliz_pilot_result.txt");
  OUT.open("w");

  function w(s) {
    OUT.writeln(s);
  }

  try {
    while (app.documents.length) {
      app.activeDocument.close(SaveOptions.DONOTSAVECHANGES);
    }
    var f = new File(PREVIEW);
    if (!f.exists) throw new Error("no preview");
    open(f);
    var doc = app.activeDocument;
    if (doc.activeLayer.isBackgroundLayer) {
      doc.activeLayer.duplicate();
    }
    doc.activeLayer.name = "test merged";
    var active = doc.activeLayer;
    for (var j = doc.layers.length - 1; j >= 0; j--) {
      if (doc.layers[j] !== active) doc.layers[j].remove();
    }
    w("smoke: layers=" + doc.layers.length);

    $.global.ELIZ_QUIET = true;
    try {
      $.evalFile(FREQ);
    } catch (freqErr) {
      w("freq err: " + freqErr.message);
    }
    w("after freq: layerSets=" + doc.layerSets.length);
    for (var i = 0; i < doc.layers.length; i++) {
      w("  " + doc.layers[i].typename + " " + doc.layers[i].name);
    }
    w("RESULT=" + (doc.layerSets.length > 0 ? "PASS" : "FAIL_FREQ"));
  } catch (e) {
    w("ERR " + e.message + " line " + e.line);
    w("RESULT=FAIL");
  }
  OUT.close();
})();
