param([Parameter(Mandatory=$true)][string]$ImagePath)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null=[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$null=[Windows.Graphics.Imaging.BitmapDecoder,Windows.Foundation,ContentType=WindowsRuntime]
$null=[Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
$null=[Windows.Globalization.Language,Windows.Globalization,ContentType=WindowsRuntime]
$asyncMethod=[System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {$_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'} | Select-Object -First 1
function Await-Result($Operation,$ResultType){$task=$asyncMethod.MakeGenericMethod($ResultType).Invoke($null,@($Operation));$task.Wait();return $task.Result}
$file=Await-Result ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
$stream=Await-Result ($file.OpenReadAsync()) ([Windows.Storage.Streams.IRandomAccessStreamWithContentType])
try{
 $decoder=Await-Result ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
 if([double]$decoder.PixelWidth*$decoder.PixelHeight -gt 16000000){throw 'OCR image exceeds pixel budget'}
 $bitmap=Await-Result ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
 try{
  if($bitmap.PixelWidth*$bitmap.PixelHeight -gt 16000000){throw 'OCR image exceeds pixel budget'}
  $language=New-Object Windows.Globalization.Language('en-US')
  $engine=[Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($language)
  if(!$engine){throw 'Installed English OCR unavailable'}
  $result=Await-Result ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  $index=0;$lines=@($result.Lines|ForEach-Object{[pscustomobject]@{order=$index++;text=$_.Text;words=@($_.Words|ForEach-Object{[pscustomobject]@{text=$_.Text;x=$_.BoundingRect.X;y=$_.BoundingRect.Y;width=$_.BoundingRect.Width;height=$_.BoundingRect.Height}})}})
  [pscustomobject]@{engine='Windows.Media.Ocr';language='en-US';confidence=$null;text=$result.Text;blocks=$lines;width=$bitmap.PixelWidth;height=$bitmap.PixelHeight;warnings=@('Vietnamese OCR language is not installed; manual review required','Engine does not expose word confidence')}|ConvertTo-Json -Depth 8 -Compress
 }finally{$bitmap.Dispose()}
}finally{$stream.Dispose()}
