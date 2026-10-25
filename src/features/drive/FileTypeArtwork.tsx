import {File,FileArchive,FileAudio,FileCode2,FileImage,FileJson,FileSpreadsheet,FileText,FileVideo,Presentation} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';

type Family='pdf'|'slides'|'document'|'sheet'|'archive'|'code'|'image'|'video'|'audio'|'other';
type IconStyle={family:Family;Icon:LucideIcon};

/** Local, vector-only format artwork. Each file explicitly displays its extension:
 * no provider request, font download, brand asset or speculative conversion. */
const formats:Record<string,IconStyle>={
  pdf:{family:'pdf',Icon:FileText},
  ppt:{family:'slides',Icon:Presentation},pptx:{family:'slides',Icon:Presentation},
  pps:{family:'slides',Icon:Presentation},ppsx:{family:'slides',Icon:Presentation},
  odp:{family:'slides',Icon:Presentation},key:{family:'slides',Icon:Presentation},
  doc:{family:'document',Icon:FileText},docx:{family:'document',Icon:FileText},
  odt:{family:'document',Icon:FileText},rtf:{family:'document',Icon:FileText},
  txt:{family:'document',Icon:FileText},md:{family:'document',Icon:FileText},
  pages:{family:'document',Icon:FileText},
  xls:{family:'sheet',Icon:FileSpreadsheet},xlsx:{family:'sheet',Icon:FileSpreadsheet},
  xlsm:{family:'sheet',Icon:FileSpreadsheet},ods:{family:'sheet',Icon:FileSpreadsheet},
  csv:{family:'sheet',Icon:FileSpreadsheet},numbers:{family:'sheet',Icon:FileSpreadsheet},
  zip:{family:'archive',Icon:FileArchive},rar:{family:'archive',Icon:FileArchive},
  '7z':{family:'archive',Icon:FileArchive},tar:{family:'archive',Icon:FileArchive},
  gz:{family:'archive',Icon:FileArchive},bz2:{family:'archive',Icon:FileArchive},
  json:{family:'code',Icon:FileJson},xml:{family:'code',Icon:FileCode2},
  html:{family:'code',Icon:FileCode2},css:{family:'code',Icon:FileCode2},
  js:{family:'code',Icon:FileCode2},jsx:{family:'code',Icon:FileCode2},
  ts:{family:'code',Icon:FileCode2},tsx:{family:'code',Icon:FileCode2},
  py:{family:'code',Icon:FileCode2},sql:{family:'code',Icon:FileCode2},
  yaml:{family:'code',Icon:FileCode2},yml:{family:'code',Icon:FileCode2},
  png:{family:'image',Icon:FileImage},jpg:{family:'image',Icon:FileImage},
  jpeg:{family:'image',Icon:FileImage},gif:{family:'image',Icon:FileImage},
  webp:{family:'image',Icon:FileImage},svg:{family:'image',Icon:FileImage},
  tif:{family:'image',Icon:FileImage},tiff:{family:'image',Icon:FileImage},
  psd:{family:'image',Icon:FileImage},ai:{family:'image',Icon:FileImage},
  mp4:{family:'video',Icon:FileVideo},mov:{family:'video',Icon:FileVideo},
  avi:{family:'video',Icon:FileVideo},mkv:{family:'video',Icon:FileVideo},
  webm:{family:'video',Icon:FileVideo},m4v:{family:'video',Icon:FileVideo},
  mp3:{family:'audio',Icon:FileAudio},wav:{family:'audio',Icon:FileAudio},
  ogg:{family:'audio',Icon:FileAudio},flac:{family:'audio',Icon:FileAudio},
  m4a:{family:'audio',Icon:FileAudio},aac:{family:'audio',Icon:FileAudio}
};

export function fileArtwork(name:string):{extension:string;family:Family;Icon:LucideIcon}|null{
  const dot=name.lastIndexOf('.');
  if(dot<=0||dot===name.length-1)return null;
  const extension=name.slice(dot+1).toLowerCase();
  if(!/^[a-z0-9]{1,8}$/.test(extension))return null;
  const format=formats[extension]||{family:'other' as const,Icon:File};
  return {extension,family:format.family,Icon:format.Icon};
}

export function FileTypeArtwork({name}:{name:string}){
  const format=fileArtwork(name);
  if(!format)return null;
  const {Icon}=format;
  return <span className="rl-format-art" data-family={format.family}
    data-extension={format.extension} aria-hidden="true">
    <span className="rl-format-sheet">
      <Icon className="rl-format-symbol" strokeWidth={1.8}/>
      <strong className="rl-format-extension">{format.extension.toUpperCase()}</strong>
    </span>
  </span>;
}
