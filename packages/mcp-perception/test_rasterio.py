import rasterio
from rasterio.windows import from_bounds
from rasterio.enums import Resampling
import traceback

bands = {
    "B02": "https://e84-earth-search-sentinel-data.s3.us-west-2.amazonaws.com/sentinel-2-c1-l2a/32/T/PL/2026/2/S2C_T32TPL_20260213T100407_L2A/B02.tif"
}
bbox = {"west": 11.4, "south": 41.4, "east": 12.99, "north": 42.4}

try:
    with rasterio.open(bands["B02"]) as src:
        print("Opened successfully:", src.profile)
        window = from_bounds(bbox["west"], bbox["south"], bbox["east"], bbox["north"], transform=src.transform)
        print("Window:", window)
        data = src.read(1, window=window, out_shape=(512, 512), resampling=Resampling.bilinear)
        print("Shape:", data.shape)
except Exception as e:
    print("FAILED!")
    traceback.print_exc()
