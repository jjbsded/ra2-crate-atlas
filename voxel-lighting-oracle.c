/* Isolated arithmetic oracle. Map a verified game's PE, never execute its entry
 * point, initialize a window, or attach to a running process. */
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
typedef void (__attribute__((thiscall)) *Identity)(float*);
typedef void (__attribute__((thiscall)) *Rotate)(float*,float);
typedef float* (__attribute__((fastcall)) *Invert)(float*,float*);
typedef float* (__attribute__((fastcall)) *Transform)(float*,float*,float*);
typedef int (__attribute__((stdcall)) *LightAngle)(float);
typedef char (__attribute__((fastcall)) *Pages)(float*,float*,float,int);
/* Let the Windows loader reserve this range before it places heaps/stacks.
 * Our own .text follows this range. The original math requires fixed globals. */
unsigned char game_space[0x813000] __attribute__((section(".game")));
int main(int argc,char **argv){
 if(argc!=2||sizeof(void*)!=4)return 2;
 FILE *f=fopen(argv[1],"rb");if(!f)return 3;
 unsigned char header[4096];
 if(fread(header,1,sizeof(header),f)!=sizeof(header))return 4;
 IMAGE_DOS_HEADER *dos=(void*)header;
 if(dos->e_magic!=IMAGE_DOS_SIGNATURE||dos->e_lfanew<0||dos->e_lfanew>2048)return 5;
 IMAGE_NT_HEADERS32 *pe=(void*)(header+dos->e_lfanew);
 if(pe->Signature!=IMAGE_NT_SIGNATURE||pe->OptionalHeader.ImageBase!=0x400000)return 5;
 unsigned char *base=game_space+0xf000;DWORD old_protect;
 if(base!=(void*)0x400000||pe->OptionalHeader.SizeOfImage>sizeof(game_space)-0xf000)return 6;
 if(!VirtualProtect(base,sizeof(game_space)-0xf000,PAGE_EXECUTE_READWRITE,&old_protect))return 6;
 /* Reserve the preferred image before allocating the multi-megabyte file. */
 fseek(f,0,SEEK_END);long n=ftell(f);rewind(f);unsigned char *file=malloc(n);
 if(fread(file,1,n,f)!=(size_t)n)return 4;fclose(f);
 dos=(void*)file;pe=(void*)(file+dos->e_lfanew);
 memcpy(base,file,pe->OptionalHeader.SizeOfHeaders);
 IMAGE_SECTION_HEADER *sec=IMAGE_FIRST_SECTION(pe);
 for(int i=0;i<pe->FileHeader.NumberOfSections;i++)memcpy(base+sec[i].VirtualAddress,file+sec[i].PointerToRawData,sec[i].SizeOfRawData);
 free(file);
 unsigned short cw=0x0e7f;__asm__ __volatile__("fldcw %0"::"m"(cw));
 ((LightAngle)0x754c00)(*(float*)0x7e1e68);
 printf("{\"light\":[%.9g,%.9g,%.9g],\"rows\":[",(double)*(float*)0x887470,(double)*(float*)0x887474,(double)*(float*)0x887478);fflush(stdout);
 for(int face=0;face<32;face++){
  /* ObjectPainter uses bridge=(mapDirection/8-8)%32. The native locomotor
   * uses the map direction in its -(direction32-8)*pi/16 rotation. */
  int direction32=(face+8)%32;
  float world[12],inverse[12],light[3],viewer[3]={0,0,1};
  ((Identity)0x5ae860)(world);
  ((Rotate)0x5aef60)(world,(float)(-60.0*0.0174532925199433));
  ((Rotate)0x5af1a0)(world,(float)(-45.0*0.0174532925199433));
  ((Rotate)0x5af1a0)(world,(float)((direction32-8)*-0.1963495408493621));
  ((Invert)0x5afc20)(inverse,world);
  ((Transform)0x5afb80)(light,inverse,(float*)0x887470);
  for(int mode=1;mode<=4;mode++){
   ((Pages)0x7586f0)(light,viewer,3.0f,mode);
   int count=((int*)0x8469f4)[mode];unsigned char *pages=(void*)0xb45990;
   printf("%s{\"face\":%d,\"mode\":%d,\"light\":[%.9g,%.9g,%.9g],\"pages\":[",face||mode>1?",":"",face,mode,(double)light[0],(double)light[1],(double)light[2]);
   for(int j=0;j<count;j++)printf("%s%u",j?",":"",pages[j]);printf("]}");
  }
 }
 puts("]}");return 0;
}
