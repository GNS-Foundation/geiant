#!/usr/bin/env python3
"""
GEIANT GDAL Worker — Python subprocess bridge
Reads JSON commands on stdin, writes JSON responses on stdout.
Uses GDAL Python bindings (osgeo) with system GDAL 3.8.4.
"""
import sys, json, os, uuid, traceback, warnings
warnings.filterwarnings('ignore')

import numpy as np
from osgeo import gdal, ogr, osr

TMP_DIR = '/tmp/geiant-gdal'
os.makedirs(TMP_DIR, exist_ok=True)

def tmp_path(ext):
    return os.path.join(TMP_DIR, f'{uuid.uuid4()}.{ext}')

def ds_to_meta(ds):
    gt = ds.GetGeoTransform()
    srs = osr.SpatialReference()
    srs.ImportFromWkt(ds.GetProjection() or '')
    srs.AutoIdentifyEPSG()
    code = srs.GetAuthorityCode(None)
    epsg = int(code) if code else None
    w, h = ds.RasterXSize, ds.RasterYSize
    bcount = ds.RasterCount
    driver = ds.GetDriver().ShortName if ds.GetDriver() else 'Unknown'
    minX = gt[0] if gt else None
    maxX = (gt[0] + w*gt[1]) if gt else None
    maxY = gt[3] if gt else None
    minY = (gt[3] + h*gt[5]) if gt else None
    bands = []
    for i in range(1, bcount+1):
        b = ds.GetRasterBand(i)
        bands.append({
            'band': i,
            'dataType': gdal.GetDataTypeName(b.DataType),
            'noDataValue': b.GetNoDataValue(),
            'colorInterp': gdal.GetColorInterpretationName(b.GetColorInterpretation()),
        })
    h3Cell = None
    if minX is not None and epsg == 4326 and maxX is not None:
        cx = (minX + maxX)/2; cy = (minY + maxY)/2
        h3Cell = f'h3:{cy:.5f},{cx:.5f}:res9'
    return {
        'driver': driver, 'width': w, 'height': h, 'bands': bcount,
        'bandInfo': bands,
        'pixelSize': {'x': abs(gt[1]) if gt else None, 'y': abs(gt[5]) if gt else None},
        'extent': {'minX': minX, 'minY': minY, 'maxX': maxX, 'maxY': maxY},
        'epsg': epsg, 'h3Cell': h3Cell,
    }

def handle_raster_info(p):
    fp = p['file_path']
    ds = gdal.Open(fp, gdal.GA_ReadOnly)
    if ds is None: raise ValueError(f'Cannot open: {fp}')
    try: return ds_to_meta(ds)
    finally: ds = None

def handle_raster_stats(p):
    fp = p['file_path']
    ds = gdal.Open(fp, gdal.GA_ReadOnly)
    if ds is None: raise ValueError(f'Cannot open: {fp}')
    try:
        total = ds.RasterCount
        targets = p.get('band_numbers') or list(range(1, total+1))
        stats = []
        for bn in targets:
            b = ds.GetRasterBand(bn)
            s = b.ComputeStatistics(False)
            stats.append({'band': bn, 'min': s[0], 'max': s[1], 'mean': s[2], 'stdDev': s[3],
                          'dataType': gdal.GetDataTypeName(b.DataType), 'noDataValue': b.GetNoDataValue()})
        return {'bands': stats, 'totalBands': total}
    finally: ds = None

def handle_reproject(p):
    geojson = p['geometry']
    target_epsg = p['target_epsg']
    src = osr.SpatialReference(); src.ImportFromEPSG(4326)
    src.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    dst = osr.SpatialReference(); dst.ImportFromEPSG(target_epsg)
    dst.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    geom = ogr.CreateGeometryFromJson(json.dumps(geojson))
    geom.AssignSpatialReference(src)
    geom.Transform(osr.CoordinateTransformation(src, dst))
    env = geom.GetEnvelope()
    return {
        'type': 'Feature',
        'properties': {'epsg': target_epsg, 'sourceEPSG': 4326},
        'geometry': json.loads(geom.ExportToJson()),
        'extent': {'minX': env[0], 'maxX': env[1], 'minY': env[2], 'maxY': env[3]},
    }

def handle_warp(p):
    out = tmp_path('tif')
    opts = gdal.WarpOptions(dstSRS=f"EPSG:{p['target_epsg']}", format='GTiff',
                             resampleAlg=gdal.GRA_Bilinear)
    result = gdal.Warp(out, p['input_path'], options=opts)
    if result is None: raise RuntimeError('gdal.Warp failed')
    result = None
    ds = gdal.Open(out); info = ds_to_meta(ds); ds = None
    return {'outputPath': out, 'targetEPSG': p['target_epsg'], 'info': info}

def handle_clip_to_geometry(p):
    out = tmp_path('tif'); mask = tmp_path('geojson')
    fc = {'type':'FeatureCollection','features':[{'type':'Feature','geometry':p['clip_geometry'],'properties':{}}]}
    with open(mask,'w') as f: json.dump(fc, f)
    try:
        opts = gdal.WarpOptions(format='GTiff', cutlineDSName=mask, cropToCutline=True, dstNodata=0)
        result = gdal.Warp(out, p['input_path'], options=opts)
        if result is None: raise RuntimeError('gdal.Warp (clip) failed')
        result = None
        ds = gdal.Open(out); info = ds_to_meta(ds); ds = None
        geom = ogr.CreateGeometryFromJson(json.dumps(p['clip_geometry']))
        env = geom.GetEnvelope()
        cx = (env[0]+env[1])/2; cy = (env[2]+env[3])/2
        return {'outputPath': out, 'clipBounds':{'minX':env[0],'maxX':env[1],'minY':env[2],'maxY':env[3]},
                'h3Cell': f'h3:{cy:.5f},{cx:.5f}:res9', 'info': info}
    finally:
        if os.path.exists(mask): os.unlink(mask)

def handle_contours(p):
    out = tmp_path('geojson')
    ds = gdal.Open(p['input_path'])
    band = ds.GetRasterBand(p.get('band_number', 1))
    s = band.ComputeStatistics(False)
    drv = ogr.GetDriverByName('GeoJSON')
    out_ds = drv.CreateDataSource(out)
    srs = osr.SpatialReference(); srs.ImportFromWkt(ds.GetProjection() or '')
    layer = out_ds.CreateLayer('contours', srs=srs, geom_type=ogr.wkbLineString)
    layer.CreateField(ogr.FieldDefn('elevation', ogr.OFTReal))
    gdal.ContourGenerate(band, p['interval_meters'], s[0], [], 0, 0, layer, -1, 0)
    feat_count = layer.GetFeatureCount()
    ds = None; out_ds = None
    with open(out) as f: geojson_out = json.load(f)
    os.unlink(out)
    return {'featureCount': feat_count, 'intervalMeters': p['interval_meters'],
            'elevationRange': {'min': s[0], 'max': s[1]}, 'geojson': geojson_out}

def handle_translate(p):
    out = tmp_path('tif')
    creation_opts = [f"{k}={v}" for k,v in (p.get('options') or {}).items()]
    if p.get('output_format') == 'COG':
        creation_opts += ['COMPRESS=LZW','TILED=YES']
    opts = gdal.TranslateOptions(format='GTiff', creationOptions=creation_opts)
    result = gdal.Translate(out, p['input_path'], options=opts)
    if result is None: raise RuntimeError('gdal.Translate failed')
    result = None
    ds = gdal.Open(out); info = ds_to_meta(ds); ds = None
    return {'outputPath': out, 'outputFormat': p.get('output_format','GTiff'), 'info': info}

def handle_band_algebra(p):
    out = tmp_path('tif')
    ds = gdal.Open(p['input_path'])
    w, h = ds.RasterXSize, ds.RasterYSize
    gt = ds.GetGeoTransform(); proj = ds.GetProjection()
    band_data = {}
    for name, bn in p['band_mapping'].items():
        b = ds.GetRasterBand(int(bn))
        arr = b.ReadAsArray().astype(np.float32)
        nd = b.GetNoDataValue()
        if nd is not None: arr[arr == nd] = np.nan
        band_data[name] = arr
    ds = None
    result_arr = eval(p['formula'], {'__builtins__': {}, 'np': np}, band_data).astype(np.float32)
    result_arr[~np.isfinite(result_arr)] = -9999
    drv = gdal.GetDriverByName('GTiff')
    out_ds = drv.Create(out, w, h, 1, gdal.GDT_Float32)
    out_ds.SetGeoTransform(gt); out_ds.SetProjection(proj)
    ob = out_ds.GetRasterBand(1); ob.SetNoDataValue(-9999); ob.WriteArray(result_arr)
    s = ob.ComputeStatistics(False); out_ds = None
    return {'outputPath': out, 'formula': p['formula'], 'bandMapping': p['band_mapping'],
            'stats': {'min': s[0], 'max': s[1], 'mean': s[2], 'stdDev': s[3]}}

def handle_h3_sample(p):
    ds = gdal.Open(p['input_path'])
    gt = ds.GetGeoTransform()
    band = ds.GetRasterBand(p.get('band_number', 1))
    nodata = band.GetNoDataValue()
    w, h = ds.RasterXSize, ds.RasterYSize
    results = []
    for cell_str in p['h3_cells']:
        try:
            parts = cell_str.split(':'); ll = parts[1].split(',')
            lat, lon = float(ll[0]), float(ll[1])
        except Exception:
            results.append({'h3Cell': cell_str, 'value': None, 'error': 'unparseable'}); continue
        px = int((lon - gt[0]) / gt[1]); py = int((lat - gt[3]) / gt[5])
        if px < 0 or px >= w or py < 0 or py >= h:
            results.append({'h3Cell': cell_str, 'lat': lat, 'lon': lon, 'value': None}); continue
        val = float(band.ReadAsArray(px, py, 1, 1)[0][0])
        if nodata is not None and abs(val - nodata) < 1e-6: val = None
        results.append({'h3Cell': cell_str, 'lat': lat, 'lon': lon, 'value': val})
    ds = None
    return {'band': p.get('band_number', 1), 'samples': results, 'totalCells': len(p['h3_cells'])}

HANDLERS = {
    'raster_info': handle_raster_info, 'raster_stats': handle_raster_stats,
    'reproject': handle_reproject, 'warp': handle_warp,
    'clip_to_geometry': handle_clip_to_geometry, 'contours': handle_contours,
    'translate': handle_translate, 'band_algebra': handle_band_algebra,
    'h3_sample': handle_h3_sample,
}

def main():
    print(json.dumps({'status': 'ready', 'gdal_version': gdal.__version__}), flush=True)
    for line in sys.stdin:
        line = line.strip()
        if not line: continue
        req_id = 'unknown'
        try:
            req = json.loads(line)
            req_id = req.get('id', 'unknown')
            tool = req.get('tool')
            if tool not in HANDLERS:
                print(json.dumps({'id': req_id, 'error': f'Unknown tool: {tool}'}), flush=True)
                continue
            result = HANDLERS[tool](req.get('params', {}))
            print(json.dumps({'id': req_id, 'result': result}), flush=True)
        except Exception as e:
            print(json.dumps({'id': req_id, 'error': str(e), 'trace': traceback.format_exc()}), flush=True)

if __name__ == '__main__':
    main()