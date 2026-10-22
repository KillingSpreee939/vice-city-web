export const resources={especial:{rows:'specialModels',parameter:'special'},roupa:{rows:'wardrobeModels',parameter:'roupa'}};

export function resourceURL(href,row){
  const url=new URL(href),resource=resources[row.collection];
  const current=url.searchParams.has('special')?'especial':url.searchParams.has('roupa')?'roupa':null;
  if(!resource||current===row.collection&&url.searchParams.get(resource.parameter)===row.name)return null;
  url.searchParams.delete('special');url.searchParams.delete('roupa');url.searchParams.delete('modelo');url.searchParams.delete('colecao');
  url.searchParams.set(resource.parameter,row.name);
  return url;
}

export const portraitKey=row=>row.collection+'-'+(resources[row.collection]?row.name:row.id);

export const catalogRows=catalog=>[...catalog.models,...catalog.specialModels,...catalog.wardrobeModels];

export function inspectionNames(href,catalog){
  const query=new URL(href).searchParams,primary=query.get('special')??query.get('roupa');
  const names=primary===null?[]:[primary];
  const key=query.get('comparar');
  if(key!==null){
    if(query.getAll('comparar').length!==1)throw Error('Comparação ambígua.');
    const row=catalogRows(catalog).find(row=>portraitKey(row)===key);
    if(!row)throw Error('Modelo de comparação não encontrado.');
    if(resources[row.collection]&&!names.includes(row.name))names.push(row.name);
  }
  return names;
}
