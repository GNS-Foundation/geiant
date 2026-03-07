import { DatasetRecord, DatasetManifest } from '../types';
export declare function generateFullDataset(): DatasetRecord[];
export declare function buildManifest(records: DatasetRecord[]): DatasetManifest;
export declare function exportToJsonl(records: DatasetRecord[], path: string): void;
export declare function exportToJson(records: DatasetRecord[], path: string): void;
export declare function exportManifest(manifest: DatasetManifest, path: string): void;
export declare function generateDatacard(manifest: DatasetManifest, records: DatasetRecord[]): string;
export declare function runExportPipeline(outputDir: string): DatasetManifest;
//# sourceMappingURL=exporter.d.ts.map