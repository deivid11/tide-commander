import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FCSTD_COLOR,
  decodeFreeCadColor,
  parseDocumentObjects,
  parseGuiDocument,
  parseShapeAppearance,
} from './fcstdColors';

function closeRgb(actual: [number, number, number] | undefined, expected: [number, number, number]) {
  expect(actual).toBeDefined();
  expect(actual![0]).toBeCloseTo(expected[0], 2);
  expect(actual![1]).toBeCloseTo(expected[1], 2);
  expect(actual![2]).toBeCloseTo(expected[2], 2);
}

describe('FreeCAD colour parsing', () => {
  it('decodes packed 0xRRGGBBAA integers from PropertyColor XML', () => {
    closeRgb(decodeFreeCadColor('421075455'), [25 / 255, 25 / 255, 25 / 255]);
    // PCB green (0.05, 0.45, 0.20) stored as 13,115,51,255
    closeRgb(decodeFreeCadColor(String((13 << 24) | (115 << 16) | (51 << 8) | 255)), [13 / 255, 115 / 255, 51 / 255]);
  });

  it('reads diffuse colour and transparency from a v3 ShapeAppearance blob', () => {
    // Real 40-byte record from c4_ensamble.FCStd ShapeAppearance2 (PCB).
    const bytes = Uint8Array.from(Buffer.from(
      '01000000ff555555ff33730dff888888ff0000006666663f00000000000000000000000000000000',
      'hex',
    ));
    const appearance = parseShapeAppearance(bytes);
    expect(appearance).not.toBeNull();
    closeRgb(appearance!.color, [0.05, 0.45, 0.20]);
    expect(appearance!.opacity).toBeCloseTo(1, 5);
  });

  it('reads App-side ShapeColor when GuiDocument.xml is missing', () => {
    const packed = (13 << 24) | (115 << 16) | (51 << 8) | 255;
    const xml = `<?xml version="1.0"?>
      <Document>
        <ObjectData Count="1">
          <Object name="PCB">
            <Properties Count="3">
              <Property name="Label" type="App::PropertyString">
                <String value="PCB"/>
              </Property>
              <Property name="Shape" type="Part::PropertyPartShape">
                <Part file="PCB.Shape.brp"/>
              </Property>
              <Property name="ShapeColor" type="App::PropertyColor">
                <PropertyColor value="${packed}"/>
              </Property>
              <Property name="Transparency" type="App::PropertyPercent">
                <Integer value="0"/>
              </Property>
            </Properties>
          </Object>
        </ObjectData>
      </Document>`;

    const objects = parseDocumentObjects(xml, new Map());
    expect(objects).toHaveLength(1);
    expect(objects[0].name).toBe('PCB');
    expect(objects[0].hasExplicitColor).toBe(true);
    closeRgb(objects[0].color, [0.05, 0.45, 0.20]);
    expect(objects[0].opacity).toBe(1);
  });

  it('falls back to the default colour only when no App or GUI colour exists', () => {
    const xml = `<?xml version="1.0"?>
      <Document>
        <ObjectData>
          <Object name="TopCase">
            <Property name="Shape" type="Part::PropertyPartShape">
              <Part file="TopCase.Shape.brp"/>
            </Property>
          </Object>
        </ObjectData>
      </Document>`;
    const objects = parseDocumentObjects(xml, new Map());
    expect(objects[0].hasExplicitColor).toBe(false);
    expect(objects[0].color).toEqual(DEFAULT_FCSTD_COLOR);
  });

  it('prefers GuiDocument colours over App properties', () => {
    const appPacked = (13 << 24) | (115 << 16) | (51 << 8) | 255;
    const guiPacked = (230 << 24) | (140 << 16) | (102 << 8) | 255;
    const documentXml = `
      <ObjectData>
        <Object name="Daisy">
          <Property name="Shape"><Part file="Daisy.Shape.brp"/></Property>
          <Property name="ShapeColor"><PropertyColor value="${appPacked}"/></Property>
        </Object>
      </ObjectData>`;
    const guiXml = `
      <ViewProvider name="Daisy">
        <Property name="ShapeColor"><PropertyColor value="${guiPacked}"/></Property>
        <Property name="Transparency"><Integer value="0"/></Property>
      </ViewProvider>`;

    const objects = parseDocumentObjects(documentXml, parseGuiDocument(guiXml));
    closeRgb(objects[0].color, [230 / 255, 140 / 255, 102 / 255]);
  });
});
