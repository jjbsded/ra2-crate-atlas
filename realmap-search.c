/* YR 1.001 0x56DC20, random-crate arguments. No game-process interaction.
 * byte mask: Track=1, Float=2, projection primary=4, origin Water=8.
 * Output per origin: uint32 count, then count uint32 cell keys (y*512+x).
 */
#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
static uint8_t grid[512*512];
static uint32_t picked[24],count,primary;
static int movement;
static void consider(int x,int y) {
    if(x<0||y<0||x>=512||y>=512||count==24) return;
    uint32_t p=y*512+x;
    if(!(grid[p]&movement)) return;
    picked[count++]=p;
    if(grid[p]&4) primary++;
}
int main(int argc,char **argv) {
    if(argc!=5) return 2;
    int maximum=atoi(argv[3]),radius=atoi(argv[4]);
    if(maximum<1||maximum>510||radius<1||radius>32) return 2;
    FILE *in=fopen(argv[1],"rb"),*out=fopen(argv[2],"wb");
    if(!in||!out) return 3;
    if(fread(grid,1,sizeof(grid),in)!=sizeof(grid)) return 4;
    fclose(in);
    for(int sy=1;sy<=maximum;sy++) for(int sx=1;sx<=maximum;sx++) {
        count=primary=0;movement=(grid[sy*512+sx]&8)?2:1;
        for(int r=0;r<radius;r++) {
            for(int d=-r;d<=r&&count<24;d++) {
                consider(sx+d,sy-r);consider(sx+d,sy+r);
            }
            for(int d=1-r;d<=r-1&&count<24;d++) {
                consider(sx-r,sy+d);consider(sx+r,sy+d);
            }
            if(count==24||primary) break;
        }
        uint32_t n=primary?primary:count;
        if(fwrite(&n,4,1,out)!=1) return 5;
        for(uint32_t i=0;i<count;i++) if(!primary||(grid[picked[i]]&4))
            if(fwrite(&picked[i],4,1,out)!=1) return 5;
    }
    return fclose(out)?5:0;
}
