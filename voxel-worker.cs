// Small x86 bridge to the user's installed CncVxlRenderText renderer.
// Protocol is local files + integer parameters. It never starts an editor.
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
class VoxelWorker {
    const string D = "CncVxlRenderText.dll";
    [DllImport("kernel32", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool SetDllDirectory(string path);
    [DllImport(D)] static extern void CncImgCreate();
    [DllImport(D)] static extern void CncImgRelease();
    [DllImport(D)] static extern void CncImgSetMaxFacing(uint count);
    [DllImport(D)] static extern void CncImgSetLightingSource(float x, float y, float z);
    [DllImport(D)] [return:MarshalAs(UnmanagedType.I1)] static extern bool CncImgLoadVPLFile(byte[] data);
    [DllImport(D)] [return:MarshalAs(UnmanagedType.I1)] static extern bool CncImgLoadVXLFile(byte[] data);
    [DllImport(D)] [return:MarshalAs(UnmanagedType.I1)] static extern bool CncImgLoadHVAFile(byte[] data);
    [DllImport(D)] static extern void CncImgClearCurrentVXL();
    [DllImport(D)] [return:MarshalAs(UnmanagedType.I1)] static extern bool CncImgPrepareVXLCache(uint facing,int f,int l,int h,int fire,[MarshalAs(UnmanagedType.I1)] bool shadow,float tilt,float dir);
    [DllImport(D)] static extern void CncImgGetImageFrame(uint face,out int w,out int h,out int x,out int y);
    [DllImport(D)] static extern void CncImgGetShadowImageFrame(uint face,out int w,out int h,out int x,out int y);
    [DllImport(D)] [return:MarshalAs(UnmanagedType.I1)] static extern bool CncImgGetImageData(uint face,out IntPtr p);
    [DllImport(D)] [return:MarshalAs(UnmanagedType.I1)] static extern bool CncImgGetShadowImageData(uint face,out IntPtr p);
    static byte[] Pixels(IntPtr ptr,int w,int h) {
        if(w<0||h<0||w>2048||h>2048) throw new Exception("Invalid voxel frame bounds "+w+"x"+h);
        byte[] data=new byte[w*h]; if(data.Length>0) Marshal.Copy(ptr,data,0,data.Length); return data;
    }
    static int Main(string[] args) {
        // Python's pipe protocol is UTF-8 regardless of the Windows code page.
        Console.InputEncoding = new UTF8Encoding(false);
        Console.OutputEncoding = new UTF8Encoding(false);
        try {
            SetDllDirectory(args[0]); CncImgCreate(); CncImgSetMaxFacing(32);
            CncImgSetLightingSource(-1,1,1);
            if(!CncImgLoadVPLFile(File.ReadAllBytes(args[1]))) throw new Exception("Invalid VPL");
            Console.WriteLine("READY"); string line;
            while((line=Console.ReadLine())!=null) {
                try {
                    string[] f=line.Split('\t');
                    CncImgClearCurrentVXL();
                    if(!CncImgLoadVXLFile(File.ReadAllBytes(f[0]))||!CncImgLoadHVAFile(File.ReadAllBytes(f[1]))) throw new Exception("Invalid VXL/HVA");
                    uint face=uint.Parse(f[2]);
                    if(!CncImgPrepareVXLCache(face,int.Parse(f[3]),int.Parse(f[4]),int.Parse(f[5]),int.Parse(f[6]),true,0,0)) throw new Exception("Voxel rendering failed");
                    int w,h,x,y,sw,sh,sx,sy; IntPtr p,sp;
                    CncImgGetImageFrame(face,out w,out h,out x,out y);
                    CncImgGetShadowImageFrame(face,out sw,out sh,out sx,out sy);
                    byte[] body, shadow=new byte[0];
                    // Mods use deliberately empty voxels (e.g. VXLINVISO) as
                    // invisible turrets. Their empty bounding rectangle is negative.
                    if(w<=0||h<=0) {w=h=1;x=y=128;body=new byte[1];}
                    else {if(!CncImgGetImageData(face,out p)) throw new Exception("Missing voxel image");body=Pixels(p,w,h);}
                    if(sw>0&&sh>0&&CncImgGetShadowImageData(face,out sp)) shadow=Pixels(sp,sw,sh);
                    else {sw=sh=0;}
                    using(BinaryWriter b=new BinaryWriter(File.Create(f[7]))) {
                        foreach(int v in new int[]{w,h,x,y,sw,sh,sx,sy}) b.Write(v);
                        b.Write(body); b.Write(shadow);
                    }
                    Console.WriteLine("OK");
                } catch(Exception e) {Console.WriteLine("ERROR "+e.Message);}
            }
            CncImgRelease(); return 0;
        } catch(Exception e) {Console.WriteLine("ERROR "+e.Message);return 1;}
    }
}
