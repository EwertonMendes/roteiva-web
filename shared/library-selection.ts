export type InspectedLibrarySource={
 provider:'google_drive'|'dropbox';connectionId:string;fileId:string;kind:'folder'|'asset';
 name:string;parentIds:string[];path?:string;
};
export type LibraryInspection={fileId:string;status:'ready';source:InspectedLibrarySource}|{fileId:string;status:'failed';code:string};
