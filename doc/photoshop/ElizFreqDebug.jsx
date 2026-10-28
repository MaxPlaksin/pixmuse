#target photoshop
(function () {
  var f = new File("/tmp/eliz_freq_debug.txt");
  f.open("w");
  try {
    var doc = app.activeDocument;
    var src = doc.activeLayer;
    f.writeln("layer=" + src.name + " layers=" + doc.layers.length);

    var low = src.duplicate();
    low.name = "dbg_low";
    doc.activeLayer = low;
    var desc = new ActionDescriptor();
    desc.putUnitDouble(charIDToTypeID("Rds "), charIDToTypeID("#Pxl"), 7);
    executeAction(charIDToTypeID("GsnB"), desc, DialogModes.NO);

    var high = src.duplicate();
    high.name = "dbg_high";
    doc.activeLayer = high;

    var d2 = new ActionDescriptor();
    d2.putEnumerated(
      charIDToTypeID("With"),
      charIDToTypeID("Wth "),
      charIDToTypeID("Sbtr")
    );
    d2.putInteger(charIDToTypeID("Opct"), 100);
    d2.putInteger(charIDToTypeID("Scl "), 2);
    d2.putInteger(charIDToTypeID("Ofst"), 128);
    var refT = new ActionReference();
    refT.putEnumerated(
      charIDToTypeID("Lyr "),
      charIDToTypeID("Ordn"),
      charIDToTypeID("Trgt")
    );
    d2.putReference(charIDToTypeID("T   "), refT);
    var refS = new ActionReference();
    refS.putIdentifier(charIDToTypeID("Lyr "), low.id);
    d2.putReference(charIDToTypeID("Src "), refS);
    executeAction(charIDToTypeID("AppI"), d2, DialogModes.ALL);
    f.writeln("apply OK");
  } catch (e) {
    f.writeln("ERR " + e.number + " " + e.message);
  }
  f.close();
})();
