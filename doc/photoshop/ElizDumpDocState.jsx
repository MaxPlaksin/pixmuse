#target photoshop
(function () {
  if (!app.documents.length) {
    return "no doc";
  }
  var f = new File("/tmp/ps_pilot_state.txt");
  f.open("w");
  var d = app.activeDocument;
  f.writeln("doc: " + d.name);
  f.writeln("mode: " + d.mode + " bits: " + d.bitsPerChannel);
  f.writeln("layerSets.count=" + d.layerSets.length);
  f.writeln("layers.count=" + d.layers.length);
  dumpLayers(d, f, 0);
  f.close();
  return "written";
  function dumpLayers(container, file, indent) {
    var pad = "";
    for (var p = 0; p < indent; p++) pad += "  ";
    for (var i = 0; i < container.layers.length; i++) {
      var L = container.layers[i];
      file.writeln(
        pad +
          L.typename +
          ": " +
          L.name +
          " vis=" +
          L.visible +
          (L.blendMode !== undefined ? " blend=" + L.blendMode : "") +
          (L.opacity !== undefined ? " op=" + L.opacity : "")
      );
      if (L.typename === "LayerSet") {
        dumpLayers(L, file, indent + 1);
      }
    }
  }
})();
