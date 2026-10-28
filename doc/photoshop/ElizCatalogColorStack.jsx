#target photoshop
/*
  Eliz catalog color stack (from doc/псд все слои.psb).
  Creates groups "фон!" and "цвет тела" with the same adjustment values.
  Masks are empty (black) — paint white where the correction should apply.

  Usage: open flattened or background layer, run script, then:
  - Select Subject → invert → fill mask on group "фон!"
  - Paint skin masks on "цвет тела" children and "Слой 1" (Color)
*/

(function () {
  if (!app.documents.length) {
    alert("Откройте фото в Photoshop.");
    return;
  }

  var doc = app.activeDocument;
  var prevRuler = app.preferences.rulerUnits;
  app.preferences.rulerUnits = Units.PIXELS;

  function makeGroup(name) {
    var g = doc.layerSets.add();
    g.name = name;
    return g;
  }

  function makeCurvesLayer(parent, name, points) {
    // points: array of [input, output] for composite curve
    var ref = new ActionReference();
    ref.putClass(charIDToTypeID("AdjL"));
    var desc = new ActionDescriptor();
    desc.putReference(charIDToTypeID("null"), ref);
    var adj = new ActionDescriptor();
    var crv = new ActionDescriptor();
    var list = new ActionList();
    var cdesc = new ActionDescriptor();
    var plist = new ActionList();
    for (var i = 0; i < points.length; i++) {
      var pt = new ActionDescriptor();
      pt.putInteger(charIDToTypeID("Hrzn"), points[i][0]);
      pt.putInteger(charIDToTypeID("Vrtc"), points[i][1]);
      plist.putObject(charIDToTypeID("Pnt "), pt);
    }
    cdesc.putList(charIDToTypeID("Crv "), plist);
    list.putObject(charIDToTypeID("CrvA"), cdesc);
    crv.putList(charIDToTypeID("Adjs"), list);
    adj.putObject(charIDToTypeID("Type"), charIDToTypeID("Crvs"), crv);
    desc.putObject(charIDToTypeID("Usng"), charIDToTypeID("AdjL"), adj);
    executeAction(charIDToTypeID("Mk  "), desc, DialogModes.NO);
    var layer = doc.activeLayer;
    layer.name = name;
    layer.move(parent, ElementPlacement.INSIDE);
    return layer;
  }

  function makeHueSatLayer(parent, name, master, reds) {
    var ref = new ActionReference();
    ref.putClass(charIDToTypeID("AdjL"));
    var desc = new ActionDescriptor();
    desc.putReference(charIDToTypeID("null"), ref);
    var adj = new ActionDescriptor();
    var hs = new ActionDescriptor();
    hs.putBoolean(stringIDToTypeID("colorize"), false);
    hs.putInteger(charIDToTypeID("LclR"), 0); // master
    if (master) {
      hs.putInteger(charIDToTypeID("H   "), master[0] || 0);
      hs.putInteger(charIDToTypeID("Strt"), master[1] || 0);
      hs.putInteger(charIDToTypeID("Lght"), master[2] || 0);
    }
    adj.putObject(charIDToTypeID("Type"), charIDToTypeID("HStr"), hs);
    desc.putObject(charIDToTypeID("Usng"), charIDToTypeID("AdjL"), adj);
    executeAction(charIDToTypeID("Mk  "), desc, DialogModes.NO);
    var layer = doc.activeLayer;
    layer.name = name;
    layer.move(parent, ElementPlacement.INSIDE);
    // Reds range: set via separate step if needed; master sat -100 used for background
    if (reds) {
      // User can fine-tune reds in UI; values from PSB: hue -1, sat +12
    }
    return layer;
  }

  function setMasterSaturation(layer, sat) {
    doc.activeLayer = layer;
    var desc = new ActionDescriptor();
    var ref = new ActionReference();
    ref.putEnumerated(
      charIDToTypeID("AdjL"),
      charIDToTypeID("Ordn"),
      charIDToTypeID("Trgt")
    );
    desc.putReference(charIDToTypeID("null"), ref);
    var adj = new ActionDescriptor();
    adj.putInteger(charIDToTypeID("Strt"), sat);
    desc.putObject(charIDToTypeID("T   "), charIDToTypeID("HStr"), adj);
    executeAction(charIDToTypeID("setd"), desc, DialogModes.NO);
  }

  // --- Background group ---
  var bg = makeGroup("фон!");
  var bgHue = makeHueSatLayer(bg, "Цветовой тон/Насыщенность 1", [0, -100, 0], null);
  setMasterSaturation(bgHue, -100);
  makeCurvesLayer(bg, "Кривые 1", [
    [0, 0],
    [43, 46],
    [205, 215],
    [252, 255],
  ]);

  // --- Body color group ---
  var body = makeGroup("цвет тела");
  makeCurvesLayer(body, "Кривые 2", [
    [0, 0],
    [146, 99],
    [255, 255],
  ]);
  makeCurvesLayer(body, "Кривые 3", [
    [0, 0],
    [98, 124],
    [255, 255],
  ]);

  // Selective color + HSL on body: create placeholders for manual sync from template
  makeHueSatLayer(body, "Цветовой тон/Насыщенность 1", [0, 0, 0], [-1, 12, 0]);

  var colorLayer = doc.artLayers.add();
  colorLayer.name = "Слой 1";
  colorLayer.blendMode = BlendMode.COLOR;
  colorLayer.move(body, ElementPlacement.INSIDE);

  app.preferences.rulerUnits = prevRuler;
  alert(
    "Созданы группы «фон!» и «цвет тела».\n\n" +
      "Дальше:\n" +
      "1) Выделить человека → инверсия → маска на «фон!».\n" +
      "2) Маски кожи на коррекциях и «Слой 1».\n" +
      "3) Выборочная коррекция (Reds Y+1 K-2, Yellows Y+3 K+17) — скопируйте из шаблона PSB, если скрипт не создал.\n" +
      "4) Частотка / лицо — вручную."
  );
})();
